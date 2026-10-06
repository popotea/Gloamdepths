"""材質包瀏覽器冒煙測試: python tests/texture-pack-smoke.py (需 Playwright Chromium)。"""
import functools
import http.server
import json
from pathlib import Path
import tempfile
import threading

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


server = http.server.ThreadingHTTPServer(
    ('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1280, 'height': 900}, device_scale_factor=2)
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.route('https://unpkg.com/**', lambda route: route.abort())
        base = f'http://127.0.0.1:{server.server_port}'
        page.goto(base)
        page.wait_for_function('PACK_ATLASES.size === PACK_GROUPS.length && [...PACK_ATLASES.values()].every(a => a.ready)')
        assert page.locator('#startTexturePack').input_value() == 'ruins'
        page.locator('#nameInput').fill('Explorer')
        page.locator('#btnNew').click()
        page.wait_for_timeout(400)
        # 以真實輸入驗證位移會切換行走圖格,衝刺產生受限數量的殘影。
        start_x = page.evaluate('myPlayer().x')
        page.keyboard.down('d')
        page.wait_for_timeout(180)
        assert page.evaluate('myPlayer().x') > start_x
        assert page.evaluate('ENTITY_MOTION.get(myPlayer()).facing') == 1
        page.keyboard.down('Shift')
        page.wait_for_timeout(100)
        assert page.evaluate('ENTITY_MOTION.get(myPlayer()).trails.length') in range(1, 6)
        page.keyboard.up('Shift')
        page.keyboard.up('d')
        page.wait_for_timeout(250)
        assert page.evaluate('ENTITY_MOTION.get(myPlayer()).frame') == 1
        assert page.locator('#hotbar .pack-icon').count() >= 3
        page.keyboard.press('e')
        page.wait_for_timeout(200)
        assert page.locator('#invpanel').is_visible()
        assert page.evaluate("UI.recipeEls.filter(el => el.querySelector('.pack-icon')).length") > 10
        page.keyboard.press('e')
        page.keyboard.press('Escape')
        page.locator('#mSettings').click()
        page.evaluate('G.paused = true')
        snapshot = 'JSON.stringify({tiles:Array.from(G.tiles), inv:myPlayer().inv})'
        before = page.evaluate(snapshot)
        page.locator('#settingsTexturePack').select_option('classic')
        assert page.locator('#hotbar .pack-icon').count() == 0
        assert page.evaluate("packItemSprite('wood_pick',32) === null")
        assert before == page.evaluate(snapshot)
        page.locator('#settingsTexturePack').select_option('ruins')
        assert page.locator('#hotbar .pack-icon').count() >= 3
        assert before == page.evaluate(snapshot)
        page.locator('#mBack').click()
        page.keyboard.press('Escape')
        # 所有新增物件都走實際地圖渲染,檢查暫停與切換未修改物件資料。
        page.evaluate('''() => {
          G.paused = true;
          const x = Math.floor(G.core.x), y = Math.floor(G.core.y);
          const types = Object.keys(OBJ_HP).concat(['crop', 'nest', 'nest']);
          types.forEach((type,i) => {
            const tx=x-8+(i%9)*2, ty=y-4+Math.floor(i/9)*2;
            setTile(tx,ty,T.FLOOR);
            setObj(tx,ty,{type,hp:OBJ_HP[type]||10,crop:'mush',stage:i%3,
              nestType:['common','swarm','elite'][i%3],fuel:i%2?20:0,ammo:10,items:[],dir:i%4,num:3});
          });
          const data=JSON.stringify([...G.objects]);
          const clock=objectVisualTime;
          render(0.016); render(0.016);
          if (JSON.stringify([...G.objects]) !== data || objectVisualTime !== clock) throw Error('Object rendering changed paused state');
          setTexturePack('classic'); render(0.016); setTexturePack('ruins'); render(0.016);
          if (JSON.stringify([...G.objects]) !== data) throw Error('Texture switch changed objects');
        }''')
        page.screenshot(path=str(Path(tempfile.gettempdir()) / 'ruins-objects-game.png'))
        preview = context.new_page()
        preview.on('pageerror', lambda error: errors.append(str(error)))
        preview.goto(base + '/tests/object-preview.html')
        preview.wait_for_function('[...PACK_ATLASES.values()].every(a => a.ready)')
        preview.locator('#pause').click()
        clock = preview.evaluate('objectVisualTime')
        preview.wait_for_timeout(100)
        assert preview.evaluate('objectVisualTime') == clock
        preview.screenshot(path=str(Path(tempfile.gettempdir()) / 'ruins-objects-preview.png'), full_page=True)
        preview.emulate_media(reduced_motion='reduce')
        preview.locator('#pause').click()
        preview.wait_for_timeout(100)
        assert preview.evaluate('objectVisualTime') == clock
        preview.close()
        # 僅在隔離的瀏覽器工作階段建立素材展示場景,不觸碰玩家存檔。
        page.evaluate('''() => {
          const me = myPlayer(); me.x = G.core.x; me.y = G.core.y - 1;
          const x = Math.floor(G.core.x), y = Math.floor(G.core.y);
          [T.DIRT,T.STONE,T.OBSIDIAN,T.COAL,T.COPPER,T.IRON,T.GOLD,T.LUMITE,T.DIAMOND,T.WOODWALL,T.STONEWALL]
            .forEach((t,i) => setTile(x-5+i,y-4,t));
          ['workbench','furnace','archer_tower','tower','lantern']
            .forEach((type,i) => setObj(x-4+i*2,y+3,{type,hp:100}));
          G.enemies = ['imp','hunter','breaker','sentinel'].map((type,i) => ({
            id:900+i,type,x:x-4+i*3,y:y+5,hp:ENEMY_TYPES[type].hp,maxhp:ENEMY_TYPES[type].hp
          }));
          UI.els.msglog.innerHTML = '';
        }''')
        page.wait_for_timeout(300)
        page.screenshot(path=str(Path(tempfile.gettempdir()) / 'ruins-preview.png'))
        page.evaluate("UI.menuOpen=true; UI.menuView='achv'; UI.els.menuPanel.classList.remove('hidden'); renderMenu()")
        assert page.locator('.bestiary-cell > .pack-icon').count() > 10
        # 確認倒地角色可繪製,而救援標記仍走原有邏輯。
        page.evaluate('myPlayer().downed = true; render(0.016)')
        page.reload()
        assert page.locator('#startTexturePack').input_value() == 'ruins'
        page.set_viewport_size({'width': 390, 'height': 844})
        page.locator('#startTexturePack').select_option('classic')
        page.reload()
        assert page.locator('#startTexturePack').input_value() == 'classic'
        page.screenshot(path=str(Path(tempfile.gettempdir()) / 'ruins-menu-mobile.png'))
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert page.evaluate('[cv.width,cv.height]') == [780, 1688]
        # 損壞/遺失素材時應退回原版,不讓開始遊戲被載圖狀態卡住。
        fallback = context.new_page()
        fallback.on('pageerror', lambda error: errors.append(str(error)))
        fallback.route('https://unpkg.com/**', lambda route: route.abort())
        fallback.route('**/assets/packs/ruins/*.png', lambda route: route.abort())
        fallback.goto(base)
        fallback.locator('#startTexturePack').select_option('ruins')
        fallback.wait_for_function('PACK_ATLASES.size === PACK_GROUPS.length && [...PACK_ATLASES.values()].every(a => a.failed)')
        fallback.locator('#btnNew').click()
        fallback.wait_for_timeout(300)
        assert fallback.evaluate('G.started')
        assert fallback.locator('#hotbar .pack-icon').count() == 0
        # 不使用 fetch / data URL 的圖集裁切必須能支援 file://。
        direct = context.new_page()
        direct.on('pageerror', lambda error: errors.append(str(error)))
        direct.route('https://unpkg.com/**', lambda route: route.abort())
        direct.goto((ROOT / 'index.html').as_uri())
        direct.wait_for_function('PACK_ATLASES.size === PACK_GROUPS.length && [...PACK_ATLASES.values()].every(a => a.ready)')
        direct.locator('#btnNew').click()
        direct.wait_for_timeout(300)
        assert direct.locator('#hotbar .pack-icon').count() >= 3
        assert not errors, errors
        print(json.dumps({'passed': True, 'errors': errors,
                          'checks': ['new game', 'inventory', 'crafting', 'switching without world changes',
                                     'bestiary', 'downed player', 'persistence', 'mobile', 'DPR 2',
                                     'failed assets fallback', 'file URL', 'directional movement', 'dash trails',
                                     'all map objects', 'object pause', 'object reduced motion', 'object data unchanged'],
                          'preview': str(Path(tempfile.gettempdir()) / 'ruins-preview.png')}))
        browser.close()
finally:
    server.shutdown()
    server.server_close()
