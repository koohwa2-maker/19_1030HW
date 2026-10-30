/* =========================================================
 * 공통 유틸: 날씨 코드, 위치 저장, 날짜 함수, API 호출
 * Open-Meteo API는 API 키 없이 사용할 수 있습니다.
 * ========================================================= */

// WMO 날씨 코드 → [설명, 아이콘]
const WMO = {
  0: ['맑음', '☀️'], 1: ['대체로 맑음', '🌤️'], 2: ['구름 조금', '⛅'], 3: ['흐림', '☁️'],
  45: ['안개', '🌫️'], 48: ['짙은 안개', '🌫️'],
  51: ['약한 이슬비', '🌦️'], 53: ['이슬비', '🌦️'], 55: ['강한 이슬비', '🌧️'],
  56: ['약한 어는 이슬비', '🌧️'], 57: ['어는 이슬비', '🌧️'],
  61: ['약한 비', '🌦️'], 63: ['비', '🌧️'], 65: ['강한 비', '🌧️'],
  66: ['약한 어는 비', '🌧️'], 67: ['어는 비', '🌧️'],
  71: ['약한 눈', '🌨️'], 73: ['눈', '🌨️'], 75: ['많은 눈', '❄️'], 77: ['싸락눈', '🌨️'],
  80: ['약한 소나기', '🌦️'], 81: ['소나기', '🌧️'], 82: ['강한 소나기', '⛈️'],
  85: ['약한 눈 소나기', '🌨️'], 86: ['눈 소나기', '❄️'],
  95: ['뇌우', '⛈️'], 96: ['우박 동반 뇌우', '⛈️'], 99: ['강한 우박 뇌우', '⛈️'],
};
function wmo(code, isDay = 1) {
  const w = WMO[code] || ['알 수 없음', '🌡️'];
  if (!isDay && (code === 0 || code === 1)) return [w[0], '🌙'];
  return w;
}

// ---------- 위치 (두 페이지가 공유) ----------
const LOC_KEY = 'dailylog.location';
const DEFAULT_LOC = { name: '서울', admin: '', country: '대한민국', lat: 37.5665, lon: 126.978 };

function getLocation() {
  try {
    const l = JSON.parse(localStorage.getItem(LOC_KEY));
    return l && typeof l.lat === 'number' ? l : DEFAULT_LOC;
  } catch { return DEFAULT_LOC; }
}
function setLocation(loc) {
  localStorage.setItem(LOC_KEY, JSON.stringify(loc));
}
function locLabel(loc) {
  return [loc.name, loc.admin, loc.country].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ');
}

// ---------- 날짜 ----------
const pad = n => String(n).padStart(2, '0');
function toDateStr(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function todayStr() { return toDateStr(new Date()); }
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return toDateStr(new Date(y, m - 1, d + n));
}
// b - a (일 단위)
function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
}
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
function formatKDate(dateStr, short = false) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const w = WEEK[new Date(y, m - 1, d).getDay()];
  return short ? `${m}/${d} (${w})` : `${y}년 ${m}월 ${d}일 (${w})`;
}

// ---------- 기타 ----------
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const round = v => (v == null ? '-' : Math.round(v));

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`요청 실패 (${res.status})`);
  return res.json();
}

// ---------- 날씨 API ----------
/**
 * 특정 날짜의 일별 날씨 (최고/최저/강수/날씨코드)
 * - 최근 약 80일 ~ 15일 뒤: 예보 API
 * - 그보다 오래된 날짜: 과거 기록(archive) API
 * - 16일 이후 미래: 데이터 없음(null)
 */
async function fetchDailyWeather(date, loc) {
  const diff = daysBetween(todayStr(), date);
  if (diff > 15) return null;
  const base = diff < -80
    ? 'https://archive-api.open-meteo.com/v1/archive'
    : 'https://api.open-meteo.com/v1/forecast';
  const params = new URLSearchParams({
    latitude: loc.lat, longitude: loc.lon,
    start_date: date, end_date: date,
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum',
    timezone: 'auto',
  });
  const j = await getJSON(`${base}?${params}`);
  const d = j.daily;
  if (!d || !d.time || !d.time.length || d.weather_code[0] == null) return null;
  return {
    code: d.weather_code[0],
    tmax: d.temperature_2m_max[0],
    tmin: d.temperature_2m_min[0],
    precip: d.precipitation_sum[0],
  };
}

// 현재 + 시간별 + 7일 예보
async function fetchForecast(loc) {
  const params = new URLSearchParams({
    latitude: loc.lat, longitude: loc.lon,
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m,wind_direction_10m,pressure_msl',
    hourly: 'temperature_2m,weather_code,precipitation_probability,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max',
    wind_speed_unit: 'ms',
    timezone: 'auto',
    forecast_days: 7,
  });
  return getJSON(`https://api.open-meteo.com/v1/forecast?${params}`);
}

// 도시 검색 (지오코딩)
async function searchCity(q) {
  const params = new URLSearchParams({ name: q, count: 8, language: 'ko', format: 'json' });
  const j = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?${params}`);
  return (j.results || []).map(r => ({
    name: r.name, admin: r.admin1 || '', country: r.country || '',
    lat: r.latitude, lon: r.longitude,
  }));
}

// 토스트 메시지
function toast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => t.classList.remove('show'), 1800);
}
