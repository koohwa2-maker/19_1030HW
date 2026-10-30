/* =========================================================
 * 2페이지: 날씨 (Open-Meteo API)
 * ========================================================= */

const $ = id => document.getElementById(id);

function showStatus(msg, type = '') {
  const s = $('status');
  s.className = `status ${type}`;
  s.innerHTML = msg;
  s.hidden = !msg;
}

const DIRS = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];
const windDir = deg => (deg == null ? '-' : DIRS[Math.round(deg / 45) % 8]);
const hhmm = iso => (iso ? iso.slice(11, 16) : '-');
function uvLevel(uv) {
  if (uv == null) return '-';
  if (uv < 3) return '낮음';
  if (uv < 6) return '보통';
  if (uv < 8) return '높음';
  if (uv < 11) return '매우 높음';
  return '위험';
}

// ---------- 렌더 ----------
function renderNow(loc, d) {
  const c = d.current;
  const [desc, icon] = wmo(c.weather_code, c.is_day);
  const t = d.daily;
  $('nowCard').className = `card now-card ${c.is_day ? 'day' : 'night'}`;
  $('nowCard').innerHTML = `
    <div class="now-left">
      <div class="now-loc">📍 ${esc(locLabel(loc))}</div>
      <div class="now-main">
        <span class="now-icon">${icon}</span>
        <span class="now-temp">${round(c.temperature_2m)}°</span>
      </div>
      <div class="now-desc">${desc}</div>
      <div class="now-sub">최고 ${round(t.temperature_2m_max[0])}° · 최저 ${round(t.temperature_2m_min[0])}° · 체감 ${round(c.apparent_temperature)}°</div>
    </div>
    <div class="now-right">
      <div><span>습도</span><b>${round(c.relative_humidity_2m)}%</b></div>
      <div><span>바람</span><b>${windDir(c.wind_direction_10m)} ${c.wind_speed_10m?.toFixed(1)}m/s</b></div>
      <div><span>강수</span><b>${c.precipitation?.toFixed(1)}mm</b></div>
      <div><span>기압</span><b>${round(c.pressure_msl)}hPa</b></div>
    </div>
    <div class="now-time muted small-text">업데이트 ${hhmm(c.time)} (현지 시각)</div>`;
}

function renderHourly(d) {
  const h = d.hourly;
  // 현재 시각 이후부터 24시간
  const nowKey = d.current.time.slice(0, 13);
  let start = h.time.findIndex(t => t.slice(0, 13) >= nowKey);
  if (start < 0) start = 0;
  const idx = [...Array(24).keys()].map(i => start + i).filter(i => i < h.time.length);

  const temps = idx.map(i => h.temperature_2m[i]);
  const min = Math.min(...temps), max = Math.max(...temps);
  const span = max - min || 1;

  $('hourly').innerHTML = idx.map((i, k) => {
    const [desc, icon] = wmo(h.weather_code[i], h.is_day[i]);
    const hr = Number(h.time[i].slice(11, 13));
    const label = k === 0 ? '지금' : `${hr}시`;
    const pop = h.precipitation_probability[i];
    const bar = 20 + ((h.temperature_2m[i] - min) / span) * 60; // 20~80%
    return `
      <div class="hour ${hr === 0 && k ? 'midnight' : ''}" title="${desc}">
        <div class="h-time">${label}</div>
        <div class="h-icon">${icon}</div>
        <div class="h-bar"><i style="height:${bar}%"></i></div>
        <div class="h-temp">${round(h.temperature_2m[i])}°</div>
        <div class="h-pop ${pop >= 50 ? 'wet' : ''}">${pop == null ? '' : `💧${pop}%`}</div>
      </div>`;
  }).join('');
}

function renderDaily(d) {
  const t = d.daily;
  const lo = Math.min(...t.temperature_2m_min), hi = Math.max(...t.temperature_2m_max);
  const span = hi - lo || 1;
  $('daily').innerHTML = t.time.map((date, i) => {
    const [desc, icon] = wmo(t.weather_code[i]);
    const name = i === 0 ? '오늘' : i === 1 ? '내일' : formatKDate(date, true);
    const left = ((t.temperature_2m_min[i] - lo) / span) * 100;
    const width = ((t.temperature_2m_max[i] - t.temperature_2m_min[i]) / span) * 100;
    const pop = t.precipitation_probability_max[i];
    return `
      <li>
        <span class="d-name">${name}</span>
        <span class="d-icon" title="${desc}">${icon}</span>
        <span class="d-pop ${pop >= 50 ? 'wet' : ''}">${pop == null ? '' : pop + '%'}</span>
        <span class="d-lo">${round(t.temperature_2m_min[i])}°</span>
        <span class="d-range"><i style="left:${left}%;width:${Math.max(width, 4)}%"></i></span>
        <span class="d-hi">${round(t.temperature_2m_max[i])}°</span>
      </li>`;
  }).join('');
}

function renderStats(d) {
  const t = d.daily, c = d.current;
  const uv = t.uv_index_max[0];
  const stats = [
    ['🌅', '일출', hhmm(t.sunrise[0])],
    ['🌇', '일몰', hhmm(t.sunset[0])],
    ['🕶️', '자외선', `${uv == null ? '-' : uv.toFixed(1)} · ${uvLevel(uv)}`],
    ['☔', '강수확률', `${t.precipitation_probability_max[0] ?? '-'}%`],
    ['🌡️', '일교차', `${round(t.temperature_2m_max[0] - t.temperature_2m_min[0])}°`],
    ['🧭', '풍향', `${windDir(c.wind_direction_10m)}풍`],
  ];
  $('todayStats').innerHTML = stats.map(([i, k, v]) => `
    <div class="stat"><span class="s-icon">${i}</span><span class="s-key">${k}</span><b>${v}</b></div>`).join('');
}

// ---------- 불러오기 ----------
async function load(loc) {
  showStatus('<span class="spinner"></span> 날씨를 불러오는 중…');
  try {
    const d = await fetchForecast(loc);
    renderNow(loc, d);
    renderHourly(d);
    renderDaily(d);
    renderStats(d);
    $('wxContent').hidden = false;
    showStatus('');
    document.title = `하루 기록 · ${loc.name} 날씨`;
  } catch (e) {
    $('wxContent').hidden = true;
    showStatus(`⚠️ 날씨를 불러오지 못했어요. 인터넷 연결을 확인해 주세요. <button class="btn ghost small" id="retry">다시 시도</button>`, 'error');
    $('retry').onclick = () => load(loc);
  }
}

function choose(loc) {
  setLocation(loc);
  $('results').hidden = true;
  $('cityInput').value = '';
  load(loc);
}

// ---------- 검색 ----------
let found = [];
$('searchForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const q = $('cityInput').value.trim();
  if (!q) return;
  const ul = $('results');
  ul.hidden = false;
  ul.innerHTML = `<li class="muted">검색 중…</li>`;
  try {
    found = await searchCity(q);
    if (!found.length) {
      ul.innerHTML = `<li class="muted">"${esc(q)}" 검색 결과가 없어요</li>`;
      return;
    }
    ul.innerHTML = found.map((r, i) => `
      <li><button type="button" data-i="${i}">
        <b>${esc(r.name)}</b> <span class="muted">${esc([r.admin, r.country].filter(Boolean).join(', '))}</span>
      </button></li>`).join('');
  } catch {
    ul.innerHTML = `<li class="muted">검색에 실패했어요</li>`;
  }
});
$('results').addEventListener('click', ev => {
  const b = ev.target.closest('[data-i]');
  if (b) choose(found[Number(b.dataset.i)]);
});

// ---------- 현재 위치 ----------
$('geoBtn').addEventListener('click', () => {
  if (!navigator.geolocation) { showStatus('이 브라우저는 위치 기능을 지원하지 않아요', 'error'); return; }
  showStatus('<span class="spinner"></span> 현재 위치 확인 중…');
  navigator.geolocation.getCurrentPosition(
    p => choose({ name: '현재 위치', admin: '', country: '', lat: +p.coords.latitude.toFixed(4), lon: +p.coords.longitude.toFixed(4) }),
    () => showStatus('위치 권한이 없어 현재 위치를 가져오지 못했어요. 도시 검색을 이용해 주세요.', 'error'),
    { timeout: 10000 }
  );
});

load(getLocation());
