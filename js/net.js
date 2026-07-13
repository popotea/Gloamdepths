// ===== 連線(PeerJS / WebRTC P2P,房主權威) =====
// 房主瀏覽器 = 伺服器:跑全部模擬、驗證動作、廣播快照;存檔只在房主

// ICE 伺服器:STUN 之外加免費 TURN 中繼(Open Relay),讓嚴格 NAT 環境也連得上。
// TURN 是「打洞失敗才走」的備援,平常直連完全不經過它;免費服務不保證永遠在,
// 掛了也只是退回原本的純 STUN 直連行為,不會更差
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turns:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];
const PEER_OPTS = { config: { iceServers: ICE_SERVERS } };

// 房主斷線轉移:房主定期把完整存檔推給「繼任者」(最早加入的客戶端),並讓所有人
// 都知道一組預先講好的「接棒房號」;房主斷線時繼任者就地開房,其他人自動跳過去。
// 手動版流程(匯出存檔→匯入接手)本來就存在,這裡只是把它自動化
const MIGRATE_CFG = {
  interval: 20,    // 備援存檔推送間隔(秒);斷線最多損失這麼多秒的進度
  chaseTries: 6,   // 非繼任者追新房間的重試次數(繼任者開房需要幾秒)
  chaseDelay: 2.5, // 每次重試間隔(秒)
  hostTimeout: 8,  // 心跳逾時(秒):快照 10Hz,這麼久沒任何訊息=房主失聯。
                   // 分頁被強制關閉時 datachannel 的 close 事件不一定會來,不能只靠它
};

const NET = {
  mode: 'single',        // 'single' | 'host' | 'client'
  peer: null,
  conns: new Map(),      // 房主用:pid -> DataConnection
  conn: null,            // 客戶端用:連向房主的連線
  nextPid: 1,
  code: '',
  snapT: 0, posT: 0,
  // ---- 房主斷線轉移狀態 ----
  succSid: null,         // 房主用:繼任者的 pid(pid 最小 = 最早加入)
  succCode: '',          // 雙方用:講好的接棒房號
  backupSave: null,      // 客戶端用:身為繼任者收到的最新備援存檔
  backupT: 0,            // 房主用:備援推送倒數
  migrating: false,      // 客戶端用:接棒流程進行中(防止 close 事件重入)
  lastMsgT: 0,           // 客戶端用:距上一個房主訊息多久(心跳偵測)

  isHost() { return this.mode !== 'client'; },
  available() { return typeof Peer !== 'undefined'; },

  _randCode() {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 5; i++) code += chars[(Math.random() * chars.length) | 0];
    return code;
  },

  // ===== 房主:開房 =====
  startHost(onOpen, onErr) {
    if (!this.available()) { onErr('無法載入連線元件(需要網路)'); return; }
    const code = this._randCode();
    this.peer = new Peer('gld-' + code, PEER_OPTS);
    this.peer.on('open', () => {
      this.mode = 'host';
      this.code = code;
      onOpen(code);
    });
    this.peer.on('error', e => {
      if (e.type === 'unavailable-id') this.startHost(onOpen, onErr); // 房號撞號就重抽
      else onErr('連線服務錯誤:' + e.type);
    });
    this.peer.on('connection', conn => this._setupConn(conn));
  },

  _setupConn(conn) {
    conn.on('data', d => this._onClientMsg(conn, d));
    conn.on('close', () => this._dropClient(conn));
    conn.on('error', () => this._dropClient(conn));
  },

  _dropClient(conn) {
    if (conn.pid === undefined) return;
    const p = G.players.get(conn.pid);
    this.conns.delete(conn.pid);
    if (p) {
      // 跟 buildSave 存同一組欄位:少了 lv/xp 的話,朋友離線再重連會掉回 1 等
      G.playersByName[p.name] = { inv: p.inv, hp: p.hp, x: p.x, y: p.y, lv: p.lv, xp: p.xp, talents: p.talents };
      G.players.delete(conn.pid);
      msgAll(`👋 ${p.name} 先下線了,深淵會想念他的~`);
      this.sendAll({ t: 'bye', id: conn.pid });
    }
    conn.pid = undefined;
    // 掉線的可能剛好是繼任者:重算並立刻把備援推給新繼任者
    const old = this.succSid;
    this._refreshSuccessor();
    if (this.succSid !== old && this.succSid !== null) this._pushBackup();
  },

  // 繼任者 = pid 最小(最早加入)的客戶端;只重算,推送由呼叫端決定
  _refreshSuccessor() {
    let sid = null;
    for (const pid of this.conns.keys()) if (sid === null || pid < sid) sid = pid;
    this.succSid = sid;
  },

  // 把完整存檔推給繼任者 + 告訴所有人「房主掛了去哪個房號集合」。
  // 存檔幾十 KB、每 20 秒/入房/繼任者變動才推一次,頻寬可忽略
  _pushBackup() {
    if (this.mode !== 'host' || this.succSid === null) return;
    if (!this.succCode) this.succCode = this._randCode();
    this.backupT = MIGRATE_CFG.interval;
    const c = this.conns.get(this.succSid);
    if (c) this.sendBig(c, { t: 'backup', save: buildSave() });
    this.sendAll({ t: 'succ', sid: this.succSid, code: this.succCode });
  },

  _onClientMsg(conn, d) {
    if (d.t === 'hi') {
      let name = String(d.name || '玩家').slice(0, 12);
      for (const pl of G.players.values()) if (pl.name === name) name += '²';
      const pid = this.nextPid++;
      conn.pid = pid;
      this.conns.set(pid, conn);
      const p = playerJoinAs(pid, name);
      this.sendBig(conn, {
        t: 'init', id: pid,
        tiles: rleEnc(G.tiles), explored: rleEnc(G.explored),
        objects: [...G.objects].map(([i, o]) => [i, o.type, o.hp ?? null, o.ammo ?? null, o.off ? 1 : 0, o.owner ?? null, o.stage ?? null, o.t ?? null, o.nestType ?? null, o.dir ?? null, o.fuel ?? null, o.items ?? null]),
        core: { energy: G.core.energy, shards: G.core.shards },
        shrines: G.shrines, traders: G.traders, wave: G.wave, time: G.time, difficulty: G.difficulty, unsealed: G.unsealed, won: G.won,
        bestiary: G.bestiary, achv: G.achv,
        players: [...G.players.values()].map(pl => [pl.id, pl.name, pl.x, pl.y, pl.hp, pl.dead ? 1 : 0, pl.lv || 1, pl.xp || 0, pl.downed ? 1 : 0, Math.ceil(pl.downedT || 0), Math.round((pl.reviveP || 0) * 100)]),
        inv: p.inv, over: G.over,
      });
      this.sendAllExcept(pid, { t: 'join', id: pid, name, x: p.x, y: p.y });
      msgAll(`🎉 ${name} 空降深淵!人多好挖礦!`);
      // 每次有人入房就重推備援:新人立刻知道接棒房號,繼任者拿到最新進度
      this._refreshSuccessor();
      this._pushBackup();
      return;
    }
    const p = G.players.get(conn.pid);
    if (!p) return;
    switch (d.t) {
      case 'pos':
        if (!p.dead) {
          p.x = clamp(+d.x || 0, 0, MAP_W); p.y = clamp(+d.y || 0, 0, MAP_H);
          p.aim = +d.aim || 0;
          // 選中格一起回報:動物的「跟隨拿飼料的人」(feederNear)才知道客戶端手上拿什麼
          if (d.s !== undefined) p.sel = clamp(d.s | 0, 0, 7);
        }
        break;
      case 'mine': doMine(p, d.x | 0, d.y | 0); break;
      case 'atk': doSwing(p, +d.aim || 0); break;
      case 'shoot': doShoot(p, +d.aim || 0); break;
      case 'place': doPlace(p, d.slot | 0, d.x | 0, d.y | 0); break;
      case 'till': doTill(p, d.x | 0, d.y | 0); break;
      case 'plant': doPlant(p, d.slot | 0, d.x | 0, d.y | 0); break;
      case 'fish': doFish(p, d.x | 0, d.y | 0); break;
      case 'recall': doRecall(p, d.slot | 0); break;
      case 'feed': doFeed(p, d.id | 0, d.slot | 0); break;
      case 'talent': applyTalent(p, String(d.id || '')); break;
      case 'repair': {
        const r = doRepair(p, d.slot | 0);
        if (r.err) this.sendToPid(conn.pid, { t: 'msg', text: '⚠️ ' + r.err });
        break;
      }
      case 'fill_tower': doFillTower(p, d.x | 0, d.y | 0); break;
      case 'toggle_tower': doToggleTower(p, d.x | 0, d.y | 0); break;
      case 'fuelminer': doFuelMiner(p, d.x | 0, d.y | 0); break;
      case 'smelter': doFeedSmelter(p, d.x | 0, d.y | 0); break;
      case 'rotatebelt': doRotateBelt(p, d.x | 0, d.y | 0); break;
      case 'storeput': doStorageDeposit(p, d.x | 0, d.y | 0, d.slot | 0); break;
      case 'storetake': doStorageWithdraw(p, d.x | 0, d.y | 0, d.si | 0); break;
      case 'storequick': doStorageQuick(p, d.x | 0, d.y | 0); break;
      case 'emote': doEmote(p, d.idx | 0); break;
      case 'eat': doEat(p, d.slot | 0); break;
      case 'deposit': doDeposit(p); break;
      case 'drop': doDropItem(p, d.slot | 0); break;
      case 'drop_at': doDropAt(p, d.slot | 0, +d.x || 0, +d.y || 0); break;
      case 'swap': swapSlots(p, d.a | 0, d.b | 0); break;
      case 'split': splitStack(p, d.slot | 0); break;
      case 'sort_inv': sortInventory(p); break;
      case 'craft': {
        const err = craftRecipe(p, d.ri | 0);
        if (err) this.sendToPid(conn.pid, { t: 'msg', text: '⚠️ ' + err });
        else this.sendToPid(conn.pid, { t: 'fx', f: { k: 'sfx', s: 'craft' } });
        break;
      }
      case 'power': {
        const text = runPowerCmd(p, d.action, d.arg, d.num);
        if (text) this.sendToPid(conn.pid, { t: 'msg', text });
        break;
      }
      case 'enh': {
        const r = doEnh(p, d.slot | 0);
        if (r.err) this.sendToPid(conn.pid, { t: 'msg', text: '⚠️ ' + r.err });
        break;
      }
      case 'trade': {
        const r = doTrade(p, d.idx | 0);
        if (r && r.err) this.sendToPid(conn.pid, { t: 'msg', text: '⚠️ ' + r.err });
        break;
      }
      case 'chat': {
        const name = String(d.name || p.name).slice(0, 12);
        const text = String(d.text || '').slice(0, 80);
        if (text) { showChat(name, text); this.sendAll({ t: 'chat', name, text }); }
        break;
      }
    }
  },

  // 大封包(init / 備援存檔)一律先 JSON 字串化再送:binarypack 序列化上萬元素的
  // 大陣列(如 rleEnc 的地圖)會堆疊溢位,而且視當下呼叫深度「偶爾成功」極難查;
  // 對單一長字串則是線性處理,實測穩定。收端在 conn.on('data') 開頭解包
  sendBig(conn, obj) {
    try { conn.send({ t: 'big', json: JSON.stringify(obj) }); } catch (e) { }
  },

  sendAll(obj) {
    for (const c of this.conns.values()) { try { c.send(obj); } catch (e) { } }
  },
  sendAllExcept(pid, obj) {
    for (const [id, c] of this.conns) if (id !== pid) { try { c.send(obj); } catch (e) { } }
  },
  sendToPid(pid, obj) {
    const c = this.conns.get(pid);
    if (c) { try { c.send(obj); } catch (e) { } }
  },

  // 房主:每 0.1 秒廣播快照
  hostTick(dt) {
    if (this.mode !== 'host' || !this.conns.size) return;
    // 定期把備援存檔推給繼任者(房主斷線轉移的心跳)
    this.backupT -= dt;
    if (this.backupT <= 0) this._pushBackup();
    this.snapT -= dt;
    if (this.snapT > 0) return;
    this.snapT = 0.1;
    const r2 = v => Math.round(v * 100) / 100;
    const snap = {
      t: 'snap', time: r2(G.time),
      players: [...G.players.values()].map(p =>
        [p.id, r2(p.x), r2(p.y), r2(p.aim), p.swing > 0 ? 1 : 0, Math.round(p.hp), p.dead ? 1 : 0, Math.ceil(p.respawnT || 0), p.lv || 1, Math.round(p.xp || 0),
         p.downed ? 1 : 0, Math.ceil(p.downedT || 0), Math.round((p.reviveP || 0) * 100)]),
      enemies: G.enemies.map(e => [e.id, e.type, r2(e.x), r2(e.y), Math.round(e.hp), e.maxhp, e.elite ? 1 : 0, e.slowT > 0 ? 1 : 0]),
      animals: G.animals.map(a => [a.id, a.type, r2(a.x), r2(a.y), Math.round(a.hp), a.fedT > 0 ? 1 : 0]),
      drops: G.drops.map(d => [d.id, d.item, d.n, r2(d.x), r2(d.y), d.lv || 0]),
      projs: G.projs.map(pj => [pj.id, r2(pj.x), r2(pj.y), pj.from === 'e' ? 1 : 0, pj.elem || null]),
      core: { e: r2(G.core.energy), s: G.core.shards },
      wave: { n: G.wave.n, state: G.wave.state, timer: Math.round(G.wave.timer), alive: G.wave.alive || 0, final: G.wave.final, endless: G.wave.endless || false, en: G.wave.en || 0 },
      kills: G.killCount,
    };
    for (const [pid, c] of this.conns) {
      const p = G.players.get(pid);
      try { c.send({ ...snap, me: p ? { inv: p.inv, hp: Math.round(p.hp), buffs: p.buffs, talents: p.talents, pts: p.talentPts | 0 } : null }); } catch (e) { }
    }
  },

  // ===== 客戶端:加入房間 =====
  join(name, code, onOk, onErr) {
    if (!this.available()) { onErr('無法載入連線元件(需要網路)'); return; }
    try { if (this.peer) this.peer.destroy(); } catch (e) { } // 接棒重連時清掉舊 peer
    const peer = this.peer = new Peer(PEER_OPTS);
    let opened = false, failed = false;
    // 失敗路徑收斂成單發:peer error 與逾時可能各來一次,若都往外報,接棒的重試鏈
    // 會分裂成多條、互相銷毀對方的 peer。放棄時一定銷毀 peer,免得這條「已放棄」的
    // 連線稍後才連上、多簽到一次變成同名殭屍玩家
    const fail = msg => {
      if (opened || failed) return;
      failed = true;
      try { peer.destroy(); } catch (e) { }
      onErr(msg);
    };
    peer.on('error', e => fail('連不上房間:' + e.type));
    peer.on('open', () => {
      const conn = peer.connect('gld-' + code.toUpperCase().trim(), { reliable: true });
      this.conn = conn;
      const failT = setTimeout(() => fail('連線逾時,請確認房號'), 8000);
      conn.on('open', () => { conn.send({ t: 'hi', name }); });
      conn.on('data', d => {
        if (d && d.t === 'big') { try { d = JSON.parse(d.json); } catch (e) { return; } } // 大封包解包
        if (d.t === 'init' && !opened) { opened = true; clearTimeout(failT); this.mode = 'client'; }
        this._onServerMsg(d);
        if (d.t === 'init') onOk();
      });
      conn.on('close', () => {
        if (opened) this._onHostLost();
      });
    });
  },

  // 與房主的連線斷了:繼任者拿備援存檔就地接棒開房,其他人去講好的房號集合;
  // 什麼都還沒收到(剛加入就斷)就維持原本的斷線畫面
  _onHostLost() {
    if (this.migrating || this.mode !== 'client') return;
    if (this.succSid === G.myId && this.backupSave && this.succCode) this._takeover();
    else if (this.succCode) this._chase();
    else { showMsg('🔌 與房主斷線了'); setOverlay('disconnected'); }
  },

  // 繼任者:用備援存檔+講好的房號就地開房。世界重建走跟「匯入存檔檔案」完全同一條
  // loadGameFromObject 路徑,朋友重連時以名字拿回背包
  _takeover() {
    const name = G.players.get(G.myId)?.name || localStorage.getItem('gld_name') || '礦工';
    const save = this.backupSave, code = this.succCode;
    this.migrating = true;
    this.backupSave = null; this.succSid = null; this.succCode = '';
    this.conn = null; this.conns.clear(); this.nextPid = 1;
    try { if (this.peer) this.peer.destroy(); } catch (e) { }
    showMsg('⚡ 房主斷線!你是繼任者,深淵交給你了——接棒開房中…');
    this.peer = new Peer('gld-' + code, PEER_OPTS);
    this.peer.on('open', () => {
      this.mode = 'host';
      this.migrating = false;
      this.code = code;
      if (!loadGameFromObject(save, name)) { showMsg('⚠️ 備援存檔損壞,無法接棒'); setOverlay('disconnected'); return; }
      // 接棒後自動存檔落到本機的空存檔欄位;沒空格就整局不落地(絕不默默蓋掉別的世界)
      SAVE_SLOT = firstEmptySlot();
      if (!SAVE_SLOT) showMsg('⚠️ 你的存檔欄位都滿了,這局進度不會自動存檔(清出空位後可用選單手動存)');
      UI.mmDirty = true; UI.invDirty = true;
      setOverlay(null);
      onBecameHost(code);
      msgAll(`⚡ ${name} 接棒成為新房主!房號:${code},大家正在趕來的路上~`);
    });
    this.peer.on('error', e => {
      // 接棒房號極小機率被占用:退回開全新房號(朋友追不到,只能手動報房號,但世界保住了)
      if (e.type === 'unavailable-id') {
        this.startHost(c => {
          if (loadGameFromObject(save, name)) { this.migrating = false; setOverlay(null); onBecameHost(c); showMsg(`⚡ 接棒成功但房號換成 ${c},把新房號告訴朋友吧`); }
        }, () => { this.migrating = false; setOverlay('disconnected'); });
      } else { this.migrating = false; showMsg('⚠️ 接棒失敗:' + e.type); setOverlay('disconnected'); }
    });
    this.peer.on('connection', conn => this._setupConn(conn));
  },

  // 非繼任者:給繼任者幾秒開房時間,然後反覆敲接棒房號的門
  _chase() {
    const name = G.players.get(G.myId)?.name || localStorage.getItem('gld_name') || '礦工';
    const code = this.succCode;
    this.migrating = true;
    setOverlay('migrating');
    let tries = 0;
    const attempt = () => {
      tries++;
      this.join(name, code, // join 保證 onOk/onErr 恰好觸發一次,重試鏈不會分裂
        () => { this.migrating = false; setOverlay(null); showMsg('✅ 接上新房主了!繼續挖!'); },
        () => {
          if (tries >= MIGRATE_CFG.chaseTries) { this.migrating = false; setOverlay('disconnected'); }
          else setTimeout(attempt, MIGRATE_CFG.chaseDelay * 1000);
        });
    };
    setTimeout(attempt, MIGRATE_CFG.chaseDelay * 1000);
  },

  _onServerMsg(d) {
    this.lastMsgT = 0; // 任何房主訊息都算心跳
    switch (d.t) {
      case 'init': {
        G.myId = d.id;
        G.tiles = rleDec(d.tiles, MAP_W * MAP_H, Uint8Array);
        G.explored = rleDec(d.explored, MAP_W * MAP_H, Uint8Array);
        G.dmg = new Float32Array(MAP_W * MAP_H);
        G.objects.clear(); G.towerIdx.clear(); G.archerTowerIdx.clear(); G.nestIdx.clear(); G.cropIdx.clear(); G.minerIdx.clear(); G.beltIdx.clear(); G.smelterIdx.clear(); G.frostIdx.clear(); G.decoyIdx.clear(); G.mushCount = 0;
        for (const [i, type, hp, ammo, off, owner, stage, t, nestType, dir, fuel, items] of d.objects) {
          const o = hp === null ? { type } : { type, hp };
          if (ammo !== null && ammo !== undefined) o.ammo = ammo;
          if (off) o.off = true;
          if (owner !== null && owner !== undefined) o.owner = owner;
          if (stage !== null && stage !== undefined) o.stage = stage;
          if (t !== null && t !== undefined) o.t = t;
          if (nestType !== null && nestType !== undefined) o.nestType = nestType;
          if (dir !== null && dir !== undefined) o.dir = dir;     // 傳輸帶方向
          if (fuel !== null && fuel !== undefined) o.fuel = fuel;  // 自動採礦機光晶燃料
          if (items !== null && items !== undefined) o.items = items; // 儲物箱內容
          G.objects.set(i, o);
          if (type === 'mushroom') G.mushCount++;
          const key = TOWER_IDX_SETS[type]; if (key) G[key].add(i);
        }
        G.core.energy = d.core.energy; G.core.shards = d.core.shards;
        G.shrines = d.shrines; G.traders = d.traders || []; G.wave = d.wave; G.time = d.time;
        G.difficulty = DIFFICULTY_CFG[d.difficulty] ? d.difficulty : 'normal';
        G.unsealed = !!d.unsealed;
        G.won = !!d.won;
        G.bestiary = d.bestiary || {}; G.achv = d.achv || {};
        G.enemies = []; G.drops = []; G.floaters = []; G.cracks.clear(); G.projs = []; G.animals = []; G.hitFx = []; G.emoteFx = [];
        G.players.clear();
        for (const [id, name, x, y, hp, dead, lv, xp, downed, downedT, revP] of d.players) {
          const p = makePlayer(id, name);
          p.lv = lv || 1; p.xp = xp || 0; p.maxhp = playerMaxHp(p);
          p.x = x; p.y = y; p.tx = x; p.ty = y; p.hp = hp; p.dead = !!dead;
          p.downed = !!downed; p.downedT = downedT || 0; p.reviveP = (revP || 0) / 100;
          G.players.set(id, p);
        }
        const me = G.players.get(G.myId);
        if (me) me.inv = d.inv;
        G.over = d.over;
        rebuildLights();
        G.started = true;
        UI.mmDirty = true; UI.invDirty = true;
        // 剛(重新)入房:清掉上一任房主的接棒狀態,新房主馬上會重發 succ/backup
        this.backupSave = null; this.succSid = null; this.succCode = '';
        break;
      }
      case 'succ':
        this.succSid = d.sid; this.succCode = d.code;
        if (d.sid !== G.myId) this.backupSave = null; // 繼任者換別人了,舊備份不留著佔記憶體
        break;
      case 'backup': this.backupSave = d.save; break;
      case 'snap': {
        for (const [id, x, y, aim, swing, hp, dead, respawnT, lv, xp, downed, downedT, revP] of d.players) {
          let p = G.players.get(id);
          if (!p) { p = makePlayer(id, '?'); G.players.set(id, p); p.x = x; p.y = y; }
          if (lv && p.lv !== lv) UI.invDirty = true;
          p.lv = lv || 1; p.xp = xp || 0; p.maxhp = playerMaxHp(p);
          p.hp = hp; p.dead = !!dead; p.respawnT = respawnT;
          p.downed = !!downed; p.downedT = downedT || 0; p.reviveP = (revP || 0) / 100;
          if (id === G.myId) continue; // 自己的位置用本地預測
          p.tx = x; p.ty = y; p.aim = aim;
          if (swing && p.swing <= 0) p.swing = 0.22;
        }
        // 敵人對帳(保留現有座標平滑插值)
        const seen = new Set();
        const byId = new Map(G.enemies.map(e => [e.id, e]));
        const list = [];
        for (const [id, type, x, y, hp, maxhp, elite, sl] of d.enemies) {
          seen.add(id);
          let e = byId.get(id);
          if (!e) e = { id, type, x, y, hp, hopT: 0 };
          e.tx = x; e.ty = y; e.hp = hp; e.maxhp = maxhp; e.elite = !!elite;
          e.sl = !!sl; // 凜鈴塔緩速旗標(render 畫 ❄ 用;host 端直接看 e.slowT)
          list.push(e);
        }
        G.enemies = list;
        // 動物對帳(同敵人:保留現有座標平滑插值;fed 給渲染畫 ❤ 用)
        {
          const byId = new Map(G.animals.map(a => [a.id, a]));
          const alist = [];
          for (const [id, type, x, y, hp, fed] of d.animals || []) {
            let a = byId.get(id);
            if (!a) a = { id, type, x, y };
            a.tx = x; a.ty = y; a.hp = hp; a.fed = !!fed;
            alist.push(a);
          }
          G.animals = alist;
        }
        G.drops = d.drops.map(([id, item, n, x, y, lv]) => ({ id, item, n, x, y, lv: lv || 0 }));
        G.projs = (d.projs || []).map(([id, x, y, fromE, elem]) => ({ id, x, y, from: fromE ? 'e' : 'p', elem }));
        G.core.energy = d.core.e; G.core.shards = d.core.s;
        G.wave = d.wave; G.time = d.time; G.killCount = d.kills || 0;
        if (d.me) {
          const me = G.players.get(G.myId);
          if (me) {
            me.inv = d.me.inv; me.hp = d.me.hp; me.buffs = d.me.buffs || {};
            me.talents = d.me.talents || {}; me.talentPts = d.me.pts | 0;
            me.maxhp = playerMaxHp(me); // talents 到手後重算,強韌體魄的血量上限才會反映在血條
            UI.invDirty = true;
          }
        }
        break;
      }
      case 'tile': setTile(d.i % MAP_W, (d.i / MAP_W) | 0, d.v, true); break;
      case 'unseal': unsealVoidZone(true); break; // 房主通關 → 客戶端也把封印牆 SEAL 換成 FLOOR
      case 'obj': setObj(d.i % MAP_W, (d.i / MAP_W) | 0, d.o, true); break;
      case 'achv': G.achv[d.id] = true; break; // 成就達成:host 已經 msgAll 廣播文字了,這裡只補狀態
      case 'seen': G.bestiary[d.type] = true; break; // 圖鑑新條目,靜默記錄不跳訊息
      case 'fx': applyFx(d.f); break;
      case 'msg': showMsg(d.text); break;
      case 'chat': showChat(d.name, d.text); break;
      case 'join': {
        const p = makePlayer(d.id, d.name);
        p.x = d.x; p.y = d.y; p.tx = d.x; p.ty = d.y;
        G.players.set(d.id, p);
        break;
      }
      case 'bye': G.players.delete(d.id); break;
      case 'tp': {
        const me = G.players.get(G.myId);
        if (me) { me.x = d.x; me.y = d.y; }
        break;
      }
      // 勝利不設 G.over(遊戲進無盡模式繼續跑),只秀慶祝畫面;失敗才是真正的結束
      case 'over':
        if (d.win) { G.won = true; setOverlay('win'); SFX.win(); }
        else { G.over = 'lose'; setOverlay('lose'); SFX.lose(); }
        break;
    }
  },

  // 客戶端:回報位置 + 插值遠端實體
  clientTick(dt) {
    if (this.mode !== 'client') return;
    // 心跳偵測:房主分頁被強制關閉時 close 事件可能永遠不來,靠「太久沒訊息」補救
    // (conn.open 守衛:接棒重連的過渡期新連線還沒開,不能誤判)
    if (G.started && !this.migrating && this.conn && this.conn.open) {
      this.lastMsgT += dt;
      if (this.lastMsgT > MIGRATE_CFG.hostTimeout) {
        this.lastMsgT = 0;
        try { if (this.conn) this.conn.close(); } catch (e) { }
        this._onHostLost();
        return;
      }
    }
    const me = G.players.get(G.myId);
    this.posT -= dt;
    if (me && this.posT <= 0 && this.conn && this.conn.open) {
      this.posT = 0.08;
      this.conn.send({ t: 'pos', x: Math.round(me.x * 100) / 100, y: Math.round(me.y * 100) / 100, aim: Math.round(me.aim * 100) / 100, s: me.sel });
    }
    const k = Math.min(1, dt * 12);
    for (const p of G.players.values()) {
      if (p.id === G.myId || p.tx === undefined) continue;
      p.x += (p.tx - p.x) * k; p.y += (p.ty - p.y) * k;
    }
    for (const e of G.enemies) {
      if (e.tx === undefined) continue;
      e.x += (e.tx - e.x) * k; e.y += (e.ty - e.y) * k;
    }
    for (const a of G.animals) {
      if (a.tx === undefined) continue;
      a.x += (a.tx - a.x) * k; a.y += (a.ty - a.y) * k;
    }
  },

  // 客戶端送出動作請求
  act(obj) {
    if (this.conn && this.conn.open) { try { this.conn.send(obj); } catch (e) { } }
  },
};
