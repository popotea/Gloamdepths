// ===== 連線(PeerJS / WebRTC P2P,房主權威) =====
// 房主瀏覽器 = 伺服器:跑全部模擬、驗證動作、廣播快照;存檔只在房主
const NET = {
  mode: 'single',        // 'single' | 'host' | 'client'
  peer: null,
  conns: new Map(),      // 房主用:pid -> DataConnection
  conn: null,            // 客戶端用:連向房主的連線
  nextPid: 1,
  code: '',
  snapT: 0, posT: 0,

  isHost() { return this.mode !== 'client'; },
  available() { return typeof Peer !== 'undefined'; },

  // ===== 房主:開房 =====
  startHost(onOpen, onErr) {
    if (!this.available()) { onErr('無法載入連線元件(需要網路)'); return; }
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 5; i++) code += chars[(Math.random() * chars.length) | 0];
    this.peer = new Peer('gld-' + code);
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
      G.playersByName[p.name] = { inv: p.inv, hp: p.hp, x: p.x, y: p.y };
      G.players.delete(conn.pid);
      msgAll(`👋 ${p.name} 離開了遊戲`);
      this.sendAll({ t: 'bye', id: conn.pid });
    }
    conn.pid = undefined;
  },

  _onClientMsg(conn, d) {
    if (d.t === 'hi') {
      let name = String(d.name || '玩家').slice(0, 12);
      for (const pl of G.players.values()) if (pl.name === name) name += '²';
      const pid = this.nextPid++;
      conn.pid = pid;
      this.conns.set(pid, conn);
      const p = playerJoinAs(pid, name);
      conn.send({
        t: 'init', id: pid,
        tiles: rleEnc(G.tiles), explored: rleEnc(G.explored),
        objects: [...G.objects].map(([i, o]) => [i, o.type, o.hp ?? null, o.ammo ?? null, o.off ? 1 : 0, o.owner ?? null, o.stage ?? null, o.t ?? null, o.nestType ?? null]),
        core: { energy: G.core.energy, shards: G.core.shards },
        shrines: G.shrines, wave: G.wave, time: G.time,
        players: [...G.players.values()].map(pl => [pl.id, pl.name, pl.x, pl.y, pl.hp, pl.dead ? 1 : 0, pl.lv || 1, pl.xp || 0]),
        inv: p.inv, over: G.over,
      });
      this.sendAllExcept(pid, { t: 'join', id: pid, name, x: p.x, y: p.y });
      msgAll(`🎉 ${name} 加入了遊戲!`);
      return;
    }
    const p = G.players.get(conn.pid);
    if (!p) return;
    switch (d.t) {
      case 'pos':
        if (!p.dead) {
          p.x = clamp(+d.x || 0, 0, MAP_W); p.y = clamp(+d.y || 0, 0, MAP_H);
          p.aim = +d.aim || 0;
        }
        break;
      case 'mine': doMine(p, d.x | 0, d.y | 0); break;
      case 'atk': doSwing(p, +d.aim || 0); break;
      case 'shoot': doShoot(p, +d.aim || 0); break;
      case 'place': doPlace(p, d.slot | 0, d.x | 0, d.y | 0); break;
      case 'till': doTill(p, d.x | 0, d.y | 0); break;
      case 'plant': doPlant(p, d.slot | 0, d.x | 0, d.y | 0); break;
      case 'fill_tower': doFillTower(p, d.x | 0, d.y | 0); break;
      case 'toggle_tower': doToggleTower(p, d.x | 0, d.y | 0); break;
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
      case 'chat': {
        const name = String(d.name || p.name).slice(0, 12);
        const text = String(d.text || '').slice(0, 80);
        if (text) { showChat(name, text); this.sendAll({ t: 'chat', name, text }); }
        break;
      }
    }
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
    this.snapT -= dt;
    if (this.snapT > 0) return;
    this.snapT = 0.1;
    const r2 = v => Math.round(v * 100) / 100;
    const snap = {
      t: 'snap', time: r2(G.time),
      players: [...G.players.values()].map(p =>
        [p.id, r2(p.x), r2(p.y), r2(p.aim), p.swing > 0 ? 1 : 0, Math.round(p.hp), p.dead ? 1 : 0, Math.ceil(p.respawnT || 0), p.lv || 1, Math.round(p.xp || 0)]),
      enemies: G.enemies.map(e => [e.id, e.type, r2(e.x), r2(e.y), Math.round(e.hp), e.maxhp, e.elite ? 1 : 0]),
      drops: G.drops.map(d => [d.id, d.item, d.n, r2(d.x), r2(d.y), d.lv || 0]),
      projs: G.projs.map(pj => [pj.id, r2(pj.x), r2(pj.y), pj.from === 'e' ? 1 : 0]),
      core: { e: r2(G.core.energy), s: G.core.shards },
      wave: { n: G.wave.n, state: G.wave.state, timer: Math.round(G.wave.timer), alive: G.wave.alive || 0, final: G.wave.final },
    };
    for (const [pid, c] of this.conns) {
      const p = G.players.get(pid);
      try { c.send({ ...snap, me: p ? { inv: p.inv, hp: Math.round(p.hp) } : null }); } catch (e) { }
    }
  },

  // ===== 客戶端:加入房間 =====
  join(name, code, onOk, onErr) {
    if (!this.available()) { onErr('無法載入連線元件(需要網路)'); return; }
    this.peer = new Peer();
    let opened = false;
    this.peer.on('error', e => { if (!opened) onErr('連不上房間:' + e.type); });
    this.peer.on('open', () => {
      const conn = this.peer.connect('gld-' + code.toUpperCase().trim(), { reliable: true });
      this.conn = conn;
      const failT = setTimeout(() => { if (!opened) onErr('連線逾時,請確認房號'); }, 8000);
      conn.on('open', () => { conn.send({ t: 'hi', name }); });
      conn.on('data', d => {
        if (d.t === 'init' && !opened) { opened = true; clearTimeout(failT); this.mode = 'client'; }
        this._onServerMsg(d);
        if (d.t === 'init') onOk();
      });
      conn.on('close', () => {
        if (opened) { showMsg('🔌 與房主斷線了'); setOverlay('disconnected'); }
      });
    });
  },

  _onServerMsg(d) {
    switch (d.t) {
      case 'init': {
        G.myId = d.id;
        G.tiles = rleDec(d.tiles, MAP_W * MAP_H, Uint8Array);
        G.explored = rleDec(d.explored, MAP_W * MAP_H, Uint8Array);
        G.dmg = new Float32Array(MAP_W * MAP_H);
        G.objects.clear(); G.towerIdx.clear(); G.archerTowerIdx.clear(); G.nestIdx.clear(); G.cropIdx.clear(); G.mushCount = 0;
        for (const [i, type, hp, ammo, off, owner, stage, t, nestType] of d.objects) {
          const o = hp === null ? { type } : { type, hp };
          if (ammo !== null && ammo !== undefined) o.ammo = ammo;
          if (off) o.off = true;
          if (owner !== null && owner !== undefined) o.owner = owner;
          if (stage !== null && stage !== undefined) o.stage = stage;
          if (t !== null && t !== undefined) o.t = t;
          if (nestType !== null && nestType !== undefined) o.nestType = nestType;
          G.objects.set(i, o);
          if (type === 'mushroom') G.mushCount++;
          const key = TOWER_IDX_SETS[type]; if (key) G[key].add(i);
        }
        G.core.energy = d.core.energy; G.core.shards = d.core.shards;
        G.shrines = d.shrines; G.wave = d.wave; G.time = d.time;
        G.enemies = []; G.drops = []; G.floaters = []; G.cracks.clear(); G.projs = [];
        G.players.clear();
        for (const [id, name, x, y, hp, dead, lv, xp] of d.players) {
          const p = makePlayer(id, name);
          p.lv = lv || 1; p.xp = xp || 0; p.maxhp = playerMaxHp(p);
          p.x = x; p.y = y; p.tx = x; p.ty = y; p.hp = hp; p.dead = !!dead;
          G.players.set(id, p);
        }
        const me = G.players.get(G.myId);
        if (me) me.inv = d.inv;
        G.over = d.over;
        rebuildLights();
        G.started = true;
        UI.mmDirty = true; UI.invDirty = true;
        break;
      }
      case 'snap': {
        for (const [id, x, y, aim, swing, hp, dead, respawnT, lv, xp] of d.players) {
          let p = G.players.get(id);
          if (!p) { p = makePlayer(id, '?'); G.players.set(id, p); p.x = x; p.y = y; }
          if (lv && p.lv !== lv) UI.invDirty = true;
          p.lv = lv || 1; p.xp = xp || 0; p.maxhp = playerMaxHp(p);
          p.hp = hp; p.dead = !!dead; p.respawnT = respawnT;
          if (id === G.myId) continue; // 自己的位置用本地預測
          p.tx = x; p.ty = y; p.aim = aim;
          if (swing && p.swing <= 0) p.swing = 0.22;
        }
        // 敵人對帳(保留現有座標平滑插值)
        const seen = new Set();
        const byId = new Map(G.enemies.map(e => [e.id, e]));
        const list = [];
        for (const [id, type, x, y, hp, maxhp, elite] of d.enemies) {
          seen.add(id);
          let e = byId.get(id);
          if (!e) e = { id, type, x, y, hp, hopT: 0 };
          e.tx = x; e.ty = y; e.hp = hp; e.maxhp = maxhp; e.elite = !!elite;
          list.push(e);
        }
        G.enemies = list;
        G.drops = d.drops.map(([id, item, n, x, y, lv]) => ({ id, item, n, x, y, lv: lv || 0 }));
        G.projs = (d.projs || []).map(([id, x, y, fromE]) => ({ id, x, y, from: fromE ? 'e' : 'p' }));
        G.core.energy = d.core.e; G.core.shards = d.core.s;
        G.wave = d.wave; G.time = d.time;
        if (d.me) {
          const me = G.players.get(G.myId);
          if (me) { me.inv = d.me.inv; me.hp = d.me.hp; UI.invDirty = true; }
        }
        break;
      }
      case 'tile': setTile(d.i % MAP_W, (d.i / MAP_W) | 0, d.v, true); break;
      case 'obj': setObj(d.i % MAP_W, (d.i / MAP_W) | 0, d.o, true); break;
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
      case 'over': G.over = d.win ? 'win' : 'lose'; setOverlay(G.over); if (d.win) SFX.win(); else SFX.lose(); break;
    }
  },

  // 客戶端:回報位置 + 插值遠端實體
  clientTick(dt) {
    if (this.mode !== 'client') return;
    const me = G.players.get(G.myId);
    this.posT -= dt;
    if (me && this.posT <= 0 && this.conn && this.conn.open) {
      this.posT = 0.08;
      this.conn.send({ t: 'pos', x: Math.round(me.x * 100) / 100, y: Math.round(me.y * 100) / 100, aim: Math.round(me.aim * 100) / 100 });
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
  },

  // 客戶端送出動作請求
  act(obj) {
    if (this.conn && this.conn.open) { try { this.conn.send(obj); } catch (e) { } }
  },
};
