// 재고조사 — 신호 없이도 화면 열기 (서비스 워커)
// ★ 이 파일은 GitHub 에서 index 파일과 같은 폴더에, 이름을 sw.js 로 해서 올립니다. 내용은 고칠 것이 없습니다.
//
// 하는 일
//  ① 화면(index)을 기기에 넣어 둠 → 화면을 올려 둔 곳(GitHub)에 닿지 않을 때는 넣어 둔 화면으로 엶
//     · 신호가 있으면 늘 새 화면을 먼저 받음. NAV_WAIT_MS 안에 끝까지 받지 못하면 넣어 둔 화면으로 열고, 새 화면은 뒤에서 마저 받아 다음에 씀
//  ② 화면이 받은 스캔 엔진 파일(주소에 버전이 박혀 있어 내용이 바뀌지 않는 것)을 넣어 둠 → 다시 받지 않고, 신호가 없어도 씀
// 하지 않는 일
//  · 서버(Apps Script)와 주고받는 것, 넣어 달라고 한 적 없는 화면, 버전이 박히지 않은 주소에는 손대지 않음 (화면을 여는 요청과 버전이 박힌 주소만 살핌)
// 끄려면: index 의 OFFLINE_SHELL 을 false 로 바꿔 올림 (이 파일을 GitHub 에서 지우는 것만으로는 이미 받은 기기에서 꺼지지 않음)
//  · 그래도 화면이 아예 열리지 않는 일이 생기면: 이 파일의 내용을 전부 지우고 아래 한 줄만 넣어 올림 (몇 분 뒤부터 기기들이 이 파일이 없던 때처럼 동작)
//      self.addEventListener('install', () => self.skipWaiting());

const CACHE = 'audit-shell-v1 ' + self.registration.scope; // 넣어 두는 곳의 이름 — 이 폴더의 것만
const NAV_WAIT_MS = 3000; // 새 화면을 이만큼 기다려도 다 오지 않으면 넣어 둔 화면으로 엶
let dropped = false; // 끄라는 알림을 받음 — 그 뒤로는 아무것도 넣어 두지 않음 (늦게 도착한 것이 치운 것을 되살리지 않게)

// 화면의 주소 — 같은 화면을 여는 여러 주소(…/ · …/index.html · 뒤에 ? 나 # 이 붙은 것)를 하나로 봄
const pageKey = url => { const u = new URL(url); return u.origin + u.pathname.replace(/\/index\.html$/, '/'); };
// 주소(경로)에 버전이 끝까지 박힌 파일 (예: …/npm/barcode-detector@3.2.3/… — @3 처럼 큰 버전만 적힌 주소는 내용이 바뀔 수 있어 넣어 두지 않음)
const pinned = url => /@\d+\.\d+\.\d+/.test(new URL(url).pathname);
// 넣어 두는 곳 열기 — 끈 뒤에는 열지 않음
const open = () => dropped ? Promise.reject(new Error('dropped')) : caches.open(CACHE);
// 넣어 둔 것 찾기 — 없거나 기기 보관함을 쓸 수 없으면 undefined (그때는 예전처럼 그냥 받음)
const saved = key => open().then(c => c.match(key)).catch(() => undefined);

// 새로 올린 sw.js 는 열려 있는 화면을 모두 닫지 않아도 곧바로 일을 넘겨받음
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.mode === 'navigate') {
    const page = openPage(req);
    event.respondWith(page.answer);
    event.waitUntil(page.rest); // 넣어 둔 화면으로 먼저 열었어도, 새 화면은 뒤에서 마저 받아 둠
  } else if (pinned(req.url)) event.respondWith(saved(req.url).then(hit => hit || fetch(req)));
});

// 화면 열기 — answer: 브라우저에 내줄 답 · rest: 뒤에서 하는 일(새 화면을 마저 받아 넣어 두기)까지 끝나는 때
function openPage(req) {
  const key = pageKey(req.url);
  const copy = saved(key); // 넣어 둔 화면 (없으면 undefined)
  const net = fetch(req);
  // 새 화면: 끝까지 받은 것만 내주고 넣어 둠 — 받다가 끊기는 곳(약한 신호)에서 반쪽 화면이 열리지 않게
  const fresh = Promise.all([copy, net]).then(async ([had, res]) => {
    if (!had || !res.ok) return res; // 넣어 달라고 한 적 없는 화면 · 오류 답은 넣어 두지 않음
    const whole = res.clone().arrayBuffer();
    const put = open().then(c => c.put(key, res.clone())).catch(() => {}); // 넣어 두지 못해도(기기 보관함이 가득 참 등) 새 화면은 내줌
    await whole;
    await put;
    return res;
  });
  const answer = copy.then(had => {
    if (!had) return net; // 넣어 달라고 한 적 없는 화면 — 손대지 않음
    // 정상 답(또는 다른 주소로 넘기는 답)이면 그대로 — 오류 답(404·503 등) · 실패 · 시간 초과면 넣어 둔 화면
    return Promise.race([fresh.catch(() => null), new Promise(r => setTimeout(() => r(null), NAV_WAIT_MS))])
      .then(res => (res && (res.ok || res.type === 'opaqueredirect')) ? res : had);
  });
  return { answer: answer, rest: fresh.catch(() => {}) };
}

let line = Promise.resolve(); // 넣어 두기는 한 번에 하나씩 (같은 것을 겹쳐 받지 않게)
self.addEventListener('message', event => {
  const d = event.data;
  if (d.type === 'keep') {
    const job = line.then(() => keep(d, event.ports[0]));
    line = job.catch(() => {}); // 한 번 실패해도 다음 것은 그대로
    event.waitUntil(line);
  }
  // 끄기 (index 의 OFFLINE_SHELL = false): 넣어 둔 것을 치우고 등록을 풂 — 치우지 못해도 등록은 풂
  if (d.type === 'drop') {
    dropped = true;
    const off = () => self.registration.unregister();
    event.waitUntil(caches.delete(CACHE).then(off, off));
  }
});

// 화면이 부탁한 것을 넣어 둠 — d.page: 그 화면의 주소 · d.urls: 그 화면이 지금까지 받은 것들의 주소 (그 가운데 버전이 박힌 파일만 넣어 둠)
async function keep(d, port) {
  const cache = await open();
  const key = pageKey(d.page);
  let fresh = false;
  if (!(await cache.match(key))) {
    const res = await fetch(d.page);
    if (res.ok && !res.redirected) { // 오류 답 · 다른 주소로 넘어간 답은 넣어 두지 않음
      await cache.put(key, res);
      fresh = !!(await cache.match(key)); // 넣은 것이 실제로 꺼내지는지까지 보고 알림 (넣었다고 답하고도 꺼내지지 않는 저장소가 있음)
    }
  }
  port.postMessage({ fresh: fresh }); // fresh: 이번에 처음 넣어 둠 → 화면이 한 번 알림
  for (const url of d.urls) {
    try {
      if (!pinned(url) || (await cache.match(url))) continue;
      const res = await fetch(url);
      if (res.ok) await cache.put(url, res);
    } catch (e) {}
  }
}
