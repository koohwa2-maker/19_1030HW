/* =========================================================
 * 1페이지: 일과 기록 (localStorage CRUD + 날짜별 날씨)
 * ========================================================= */

const STORE_KEY = 'dailylog.entries';
const WX_CACHE_KEY = 'dailylog.wxcache';
const NOTE_KEY = 'dailylog.notes';

// ---------- 저장소 (CRUD) ----------
const Store = {
  all() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; }
    catch { return []; }
  },
  save(list) { localStorage.setItem(STORE_KEY, JSON.stringify(list)); },

  // Create
  create(data) {
    const list = this.all();
    const item = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...data,
    };
    list.push(item);
    this.save(list);
    return item;
  },
  // Read
  byDate(date) {
    return this.all()
      .filter(e => e.date === date)
      .sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99') || a.createdAt.localeCompare(b.createdAt));
  },
  get(id) { return this.all().find(e => e.id === id); },
  // Update
  update(id, patch) {
    const list = this.all();
    const i = list.findIndex(e => e.id === id);
    if (i < 0) return null;
    list[i] = { ...list[i], ...patch, updatedAt: new Date().toISOString() };
    this.save(list);
    return list[i];
  },
  // Delete
  remove(id) { this.save(this.all().filter(e => e.id !== id)); },
};

// ---------- 하루 메모 저장소 { 'YYYY-MM-DD': { text, weather, updatedAt } } ----------
const Notes = {
  all() {
    try { return JSON.parse(localStorage.getItem(NOTE_KEY)) || {}; }
    catch { return {}; }
  },
  get(date) { return this.all()[date] || null; },
  // 내용과 날씨가 모두 비면 그 날짜의 메모를 지움
  set(date, patch) {
    const all = this.all();
    const n = { ...all[date], ...patch, updatedAt: new Date().toISOString() };
    if (!n.text && !n.weather) delete all[date];
    else all[date] = n;
    localStorage.setItem(NOTE_KEY, JSON.stringify(all));
    return all[date] || null;
  },
};

// ---------- 날씨 캐시 (지난 날짜는 변하지 않으므로 저장해 둠) ----------
function wxCacheGet(key) {
  try { return (JSON.parse(localStorage.getItem(WX_CACHE_KEY)) || {})[key]; } catch { return undefined; }
}
function wxCacheSet(key, val) {
  let c = {};
  try { c = JSON.parse(localStorage.getItem(WX_CACHE_KEY)) || {}; } catch {}
  c[key] = val;
  const keys = Object.keys(c);
  if (keys.length > 300) keys.slice(0, keys.length - 300).forEach(k => delete c[k]);
  localStorage.setItem(WX_CACHE_KEY, JSON.stringify(c));
}
async function getDayWeather(date, loc) {
  const key = `${loc.lat.toFixed(2)},${loc.lon.toFixed(2)}|${date}`;
  const cached = wxCacheGet(key);
  if (cached) return cached;
  const w = await fetchDailyWeather(date, loc);
  // 이틀 이상 지난 날짜만 캐시 (오늘·미래는 예보가 바뀜)
  if (w && daysBetween(date, todayStr()) >= 2) wxCacheSet(key, w);
  return w;
}

// ---------- 상태 & DOM ----------
const $ = id => document.getElementById(id);
const state = { date: todayStr(), editingId: null };
const CAT_COLOR = { 업무: 'c1', 공부: 'c2', 운동: 'c3', 생활: 'c4', 휴식: 'c5', 기타: 'c6' };

// ---------- 위치 ----------
// 메인 페이지 날씨는 현재 위치가 기본. 지역을 직접 고르면 그 지역을 사용하고,
// 위치 권한 거부·실패 시 저장된 위치(없으면 서울) 사용
const MAIN_LOC_KEY = 'dailylog.mainLocation';
function getMainLoc() {
  try {
    const l = JSON.parse(localStorage.getItem(MAIN_LOC_KEY));
    return l && typeof l.lat === 'number' ? l : null;
  } catch { return null; }
}
let geoLoc = null;
function getCurrentLoc() {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      p => resolve({ name: '현재 위치', admin: '', country: '', lat: +p.coords.latitude.toFixed(4), lon: +p.coords.longitude.toFixed(4) }),
      () => resolve(null),
      { timeout: 10000, maximumAge: 10 * 60 * 1000 }
    );
  });
}
let geoReady = getMainLoc() ? Promise.resolve() : getCurrentLoc().then(l => { geoLoc = l; });

// ---------- 날씨 카드 ----------
let wxReq = 0;
let lastWx = null; // 날씨 카드에 표시 중인 날씨 { date, loc, w }
async function renderDayWeather() {
  const box = $('dayWeather');
  const req = ++wxReq;
  box.innerHTML = `<div class="dw-loading">날씨 불러오는 중…</div>`;
  await geoReady;
  if (req !== wxReq) return;
  const loc = getMainLoc() || geoLoc || getLocation();
  $('locName').textContent = locLabel(loc);
  lastWx = null;
  renderNoteWx();
  try {
    const w = await getDayWeather(state.date, loc);
    if (req !== wxReq) return; // 날짜가 바뀌었으면 무시
    lastWx = w ? { date: state.date, loc, w } : null;
    renderNoteWx();
    if (!w) {
      box.innerHTML = `
        <div class="dw-empty">🔭 이 날짜의 날씨 정보가 아직 없어요
          <span class="muted small-text">(예보는 약 15일 뒤까지 제공)</span></div>`;
      return;
    }
    const [desc, icon] = wmo(w.code);
    box.innerHTML = `
      <div class="dw-main">
        <span class="dw-icon">${icon}</span>
        <div>
          <div class="dw-desc">${desc}</div>
          <div class="dw-temp"><span class="hi">${round(w.tmax)}°</span> / <span class="lo">${round(w.tmin)}°</span></div>
        </div>
        <div class="dw-rain">💧 ${w.precip == null ? '-' : w.precip.toFixed(1)}mm</div>
      </div>`;
  } catch (e) {
    if (req !== wxReq) return;
    box.innerHTML = `<div class="dw-empty">⚠️ 날씨를 불러오지 못했어요 <button class="btn ghost small" id="wxRetry">다시 시도</button></div>`;
    $('wxRetry').onclick = renderDayWeather;
  }
}

// ---------- 지역 선택 ----------
function toggleLocPanel(open = $('locPanel').hidden) {
  $('locPanel').hidden = !open;
  $('locToggle').setAttribute('aria-expanded', open);
  if (open) $('locInput').focus();
  else { $('locResults').hidden = true; $('locInput').value = ''; }
}
$('locToggle').addEventListener('click', () => toggleLocPanel());

let locFound = [];
$('locForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const q = $('locInput').value.trim();
  if (!q) return;
  const ul = $('locResults');
  ul.hidden = false;
  ul.innerHTML = `<li class="muted">검색 중…</li>`;
  try {
    locFound = await searchCity(q);
    if (!locFound.length) {
      ul.innerHTML = `<li class="muted">"${esc(q)}" 검색 결과가 없어요</li>`;
      return;
    }
    ul.innerHTML = locFound.map((r, i) => `
      <li><button type="button" data-i="${i}">
        <b>${esc(r.name)}</b> <span class="muted">${esc([r.admin, r.country].filter(Boolean).join(', '))}</span>
      </button></li>`).join('');
  } catch {
    ul.innerHTML = `<li class="muted">검색에 실패했어요</li>`;
  }
});
$('locResults').addEventListener('click', ev => {
  const b = ev.target.closest('[data-i]');
  if (!b) return;
  const loc = locFound[Number(b.dataset.i)];
  localStorage.setItem(MAIN_LOC_KEY, JSON.stringify(loc));
  toggleLocPanel(false);
  renderDayWeather();
});
$('locGeo').addEventListener('click', () => {
  if (!navigator.geolocation) { toast('이 브라우저는 위치 기능을 지원하지 않아요'); return; }
  localStorage.removeItem(MAIN_LOC_KEY);
  geoReady = getCurrentLoc().then(l => {
    geoLoc = l;
    if (!l) toast('위치 권한이 없어 현재 위치를 가져오지 못했어요');
  });
  toggleLocPanel(false);
  renderDayWeather();
});

// ---------- 하루 메모 ----------
const WX_KINDS = {
  clear: ['맑음', '☀️'], partly: ['구름 조금', '⛅'], cloudy: ['흐림', '☁️'], rain: ['비', '🌧️'],
  snow: ['눈', '❄️'], fog: ['안개', '🌫️'], storm: ['뇌우', '⛈️'],
};
// WMO 날씨 코드 → 선택 버튼 종류
function wxKind(code) {
  if (code === 0) return 'clear';
  if (code <= 2) return 'partly';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storm';
  return 'rain';
}
$('noteWxChips').innerHTML = Object.entries(WX_KINDS).map(([k, [label, icon]]) =>
  `<button type="button" class="wx-chip" data-kind="${k}" aria-pressed="false">${icon} ${label}</button>`).join('');

function renderNoteWx() {
  const wx = Notes.get(state.date)?.weather;
  document.querySelectorAll('.wx-chip').forEach(b => {
    const on = wx?.kind === b.dataset.kind;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on);
  });
  const auto = $('noteWxAuto');
  auto.disabled = !(lastWx && lastWx.date === state.date);
  auto.title = auto.disabled ? '이 날짜의 날씨 정보가 없어요' : '왼쪽 날씨 카드의 정보를 그대로 기록해요';

  const box = $('noteWxSaved');
  if (!wx) { box.innerHTML = `<span class="muted">아직 기록한 날씨가 없어요</span>`; return; }
  const parts = [`${wx.icon} ${esc(wx.label)}`];
  if (wx.tmax != null) parts.push(`<span class="hi">${round(wx.tmax)}°</span> / <span class="lo">${round(wx.tmin)}°</span>`);
  if (wx.precip != null) parts.push(`💧 ${wx.precip.toFixed(1)}mm`);
  parts.push(wx.loc ? `📍 ${esc(wx.loc)}` : '<span class="muted">직접 선택</span>');
  box.innerHTML = `<b>기록됨</b> ${parts.join(' · ')}`;
}

function renderNote() {
  const n = Notes.get(state.date);
  const ta = $('noteText');
  // 입력 중에는 덮어쓰지 않음
  if (document.activeElement !== ta && ta.value !== (n?.text || '')) ta.value = n?.text || '';
  $('noteStatus').textContent = n ? `${new Date(n.updatedAt).toTimeString().slice(0, 5)} 저장됨` : '';
  renderNoteWx();
}
function afterNoteChange() {
  renderNote();
  renderSummary();
}

// 입력할 때마다 자동 저장
$('noteText').addEventListener('input', e => {
  Notes.set(state.date, { text: e.target.value.trim() ? e.target.value : '' });
  afterNoteChange();
});
$('noteClear').addEventListener('click', () => {
  if (!Notes.get(state.date)?.text) return;
  if (!confirm('이 날짜의 메모 내용을 비울까요?')) return;
  Notes.set(state.date, { text: '' });
  afterNoteChange();
});
$('noteWxChips').addEventListener('click', ev => {
  const b = ev.target.closest('[data-kind]');
  if (!b) return;
  const kind = b.dataset.kind;
  const [label, icon] = WX_KINDS[kind];
  // 같은 날씨를 다시 누르면 기록 해제
  const same = Notes.get(state.date)?.weather?.kind === kind;
  Notes.set(state.date, { weather: same ? null : { kind, label, icon } });
  afterNoteChange();
});
$('noteWxAuto').addEventListener('click', () => {
  if (!lastWx || lastWx.date !== state.date) return;
  const { w, loc } = lastWx;
  const [label, icon] = wmo(w.code);
  Notes.set(state.date, {
    weather: { kind: wxKind(w.code), label, icon, tmax: w.tmax, tmin: w.tmin, precip: w.precip, loc: locLabel(loc) },
  });
  toast('날씨를 기록했어요');
  afterNoteChange();
});

// ---------- 목록 ----------
function renderList() {
  const items = Store.byDate(state.date);
  const list = $('entryList');
  const isToday = state.date === todayStr();
  $('listTitle').textContent = `${formatKDate(state.date)}${isToday ? ' · 오늘' : ''}`;

  const done = items.filter(i => i.done).length;
  $('progressText').textContent = items.length ? `${done}/${items.length} 완료` : '';
  $('progressBar').style.width = items.length ? `${(done / items.length) * 100}%` : '0';

  if (!items.length) {
    list.innerHTML = `<li class="empty">아직 기록이 없어요.<br>왼쪽에서 오늘 한 일을 추가해 보세요 ✍️</li>`;
    return;
  }

  list.innerHTML = items.map(i => `
    <li class="entry ${i.done ? 'done' : ''} ${i.id === state.editingId ? 'editing' : ''}" data-id="${i.id}">
      <button class="chk" data-act="toggle" aria-label="완료 전환">${i.done ? '✓' : ''}</button>
      <div class="entry-body">
        <div class="entry-top">
          ${i.time ? `<span class="time">${esc(i.time)}</span>` : ''}
          <span class="tag ${CAT_COLOR[i.category] || 'c6'}">${esc(i.category)}</span>
          <span class="title">${esc(i.title)}</span>
        </div>
        ${i.memo ? `<p class="memo">${esc(i.memo)}</p>` : ''}
      </div>
      <div class="entry-act">
        <button class="icon-btn" data-act="edit" aria-label="수정" title="수정">✏️</button>
        <button class="icon-btn" data-act="delete" aria-label="삭제" title="삭제">🗑️</button>
      </div>
    </li>`).join('');
}

// ---------- 날짜별 요약 ----------
function renderSummary() {
  const groups = {};
  Store.all().forEach(e => {
    (groups[e.date] ||= { total: 0, done: 0 });
    groups[e.date].total++;
    if (e.done) groups[e.date].done++;
  });
  const notes = Notes.all();
  Object.keys(notes).forEach(d => { groups[d] ||= { total: 0, done: 0 }; });
  const dates = Object.keys(groups).sort().reverse();
  const ul = $('dateSummary');
  if (!dates.length) {
    ul.innerHTML = `<li class="empty small">기록된 날짜가 없어요</li>`;
    return;
  }
  ul.innerHTML = dates.map(d => `
    <li class="${d === state.date ? 'active' : ''}" data-date="${d}">
      <span>${formatKDate(d, true)} ${notes[d]?.weather ? `<span title="${esc(notes[d].weather.label)}">${notes[d].weather.icon}</span>` : ''}</span>
      <span class="muted">${notes[d]?.text ? '<span title="메모 있음">📝</span> ' : ''}${groups[d].total ? `${groups[d].done}/${groups[d].total}` : ''}</span>
    </li>`).join('');
}

// ---------- 폼 ----------
function resetForm() {
  state.editingId = null;
  $('entryForm').reset();
  $('formTitle').textContent = '새 일과 기록';
  $('submitBtn').textContent = '추가';
  $('cancelEdit').hidden = true;
  $('entryForm').classList.remove('is-editing');
}
function startEdit(id) {
  const e = Store.get(id);
  if (!e) return;
  state.editingId = id;
  $('fTime').value = e.time || '';
  $('fCategory').value = e.category;
  $('fTitle').value = e.title;
  $('fMemo').value = e.memo || '';
  $('fDone').checked = !!e.done;
  $('formTitle').textContent = '일과 수정';
  $('submitBtn').textContent = '저장';
  $('cancelEdit').hidden = false;
  $('entryForm').classList.add('is-editing');
  $('fTitle').focus();
  renderList();
}

$('entryForm').addEventListener('submit', ev => {
  ev.preventDefault();
  const data = {
    time: $('fTime').value,
    category: $('fCategory').value,
    title: $('fTitle').value.trim(),
    memo: $('fMemo').value.trim(),
    done: $('fDone').checked,
  };
  if (!data.title) { $('fTitle').focus(); return; }

  if (state.editingId) {
    Store.update(state.editingId, data);
    toast('수정했어요');
  } else {
    Store.create({ ...data, date: state.date });
    toast('추가했어요');
  }
  resetForm();
  renderAll(false);
});
$('cancelEdit').addEventListener('click', () => { resetForm(); renderList(); });

// 목록 클릭 (이벤트 위임)
$('entryList').addEventListener('click', ev => {
  const btn = ev.target.closest('[data-act]');
  if (!btn) return;
  const id = btn.closest('.entry').dataset.id;
  const act = btn.dataset.act;
  if (act === 'toggle') {
    const e = Store.get(id);
    Store.update(id, { done: !e.done });
    renderAll(false);
  } else if (act === 'edit') {
    startEdit(id);
  } else if (act === 'delete') {
    const e = Store.get(id);
    if (confirm(`"${e.title}" 기록을 삭제할까요?`)) {
      Store.remove(id);
      if (state.editingId === id) resetForm();
      toast('삭제했어요');
      renderAll(false);
    }
  }
});

$('dateSummary').addEventListener('click', ev => {
  const li = ev.target.closest('[data-date]');
  if (li) goTo(li.dataset.date);
});

// ---------- 날짜 이동 ----------
function goTo(date) {
  if (!date) return;
  state.date = date;
  resetForm();
  renderAll(true);
}
$('datePicker').addEventListener('change', e => goTo(e.target.value));
$('prevDay').addEventListener('click', () => goTo(addDays(state.date, -1)));
$('nextDay').addEventListener('click', () => goTo(addDays(state.date, 1)));
$('todayBtn').addEventListener('click', () => goTo(todayStr()));

function renderAll(withWeather = true) {
  $('datePicker').value = state.date;
  renderList();
  renderNote();
  renderSummary();
  if (withWeather) renderDayWeather();
}

// 다른 탭에서 데이터가 바뀌면 반영
window.addEventListener('storage', e => {
  if (e.key === STORE_KEY || e.key === NOTE_KEY) renderAll(false);
  if (e.key === MAIN_LOC_KEY || (e.key === LOC_KEY && !getMainLoc() && !geoLoc)) renderDayWeather();
});

renderAll(true);
