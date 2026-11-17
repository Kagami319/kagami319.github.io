import {fetchDotaStats} from './dota-api.js';
import {showGameInventory} from './game-inventory.js?v=20261117-curated';

const $ = (id) => document.getElementById(id);
const ACCOUNT_ID = '889388443';
const CACHE_KEY = 'shihao-dota-heroes-v2';
let publications = [];
let currentStats = null;
let refreshPending = false;
let allHeroesShown = false;
let stratzKda = new Map();
let stratzProvidedAt = '';
const number = new Intl.NumberFormat('en-US');

$('copyright-year').textContent = String(new Date().getFullYear());

const pageTabs = [...document.querySelectorAll('.page-tab')];
function selectPage(sectionId) {
  const selected = pageTabs.find(tab => tab.getAttribute('aria-controls') === sectionId) || pageTabs[0];
  pageTabs.forEach(tab => {
    const active = tab === selected;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    $(tab.getAttribute('aria-controls')).hidden = !active;
  });
}
pageTabs.forEach((tab, index) => {
  tab.addEventListener('click', event => {
    event.preventDefault();
    selectPage(tab.getAttribute('aria-controls'));
    if (location.hash !== tab.hash) history.pushState(null, '', tab.hash);
  });
  tab.addEventListener('keydown', event => {
    let nextIndex;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % pageTabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index + pageTabs.length - 1) % pageTabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = pageTabs.length - 1;
    else return;
    event.preventDefault();
    pageTabs[nextIndex].click();
    pageTabs[nextIndex].focus();
  });
});
function selectPageFromLocation() { selectPage(location.hash.slice(1)); }
window.addEventListener('hashchange', selectPageFromLocation);
window.addEventListener('popstate', selectPageFromLocation);
selectPageFromLocation();


function el(tag, className, text) {
  const node = document.createElement(tag);
  if(className) node.className=className;
  if(text != null) node.textContent=String(text);
  return node;
}
function safeUrl(value) {
  try { const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.href:null; } catch {return null;}
}
function externalLink(text,url,className='') {
  const a=el('a',className,text);a.href=safeUrl(url)||'#';a.target='_blank';a.rel='noopener noreferrer';return a;
}
function renderPublications(topic='all') {
  const list=$('publication-list');list.replaceChildren();
  const filtered=publications.filter(p=>topic==='all'||p.category===topic);
  const papers=el('div','papers');
  if(!filtered.length)papers.append(el('p','empty-filter','No papers in this topic yet.'));
  filtered.forEach((p,index)=>{
    const row=el('article','paper');
    const body=el('div','paper-info');
    const h=el('h3','papertitle',`[${index+1}] ${p.title}`);
    if(safeUrl(p.url)){
      const link=externalLink('[link]',p.url,'paper-title-link');link.setAttribute('aria-label',`Open paper: ${p.title}`);
      h.append(document.createTextNode(' '),link);
    }
    const authors=el('p','paper-authors');p.authors.forEach((author,i)=>{
      if(i)authors.append(document.createTextNode(', '));
      authors.append(el(author==='Shihao Wang'?'strong':'span','',author));
    });
    const status=p.displayStatus||(p.status==='published'?'Published':'Preprint');
    const venue=el('div','paper-venue');venue.append(el('span','paper-status',status));
    const venueText=(p.venue||'').replace(/^arXiv preprint\s*·\s*/i,'');
    if(venueText&&venueText.toLowerCase()!==status.toLowerCase()){
      venue.append(document.createTextNode(' · '),el('em','',venueText));
      if(p.year!=null&&!venueText.includes(String(p.year)))venue.append(document.createTextNode(`, ${p.year}`));
    }
    body.append(h,authors,venue);
    if(p.contributionNote)body.append(el('p','contribution-note',p.contributionNote));
    const links=el('div','paper-links');
    if(p.codeUrl)links.append(externalLink('code',p.codeUrl));
    if(links.children.length)body.append(links);
    row.append(body);papers.append(row);
  });
  list.append(papers);
}
document.querySelectorAll('.filter').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('.filter').forEach(b=>{const active=b===button;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});renderPublications(button.dataset.topic);}));
async function loadPublications(){
  try{
    const response=await fetch('./publications.json');if(!response.ok)throw new Error('Publications unavailable');
    const data=await response.json();publications=data.publications.sort((a,b)=>String(b.date||b.year||'').localeCompare(String(a.date||a.year||'')));
    renderPublications(document.querySelector('.filter.active').dataset.topic);
  }catch{$('publication-list').replaceChildren(el('p','loading-note','Publications could not be loaded. Please reload the page.'));}
}

const esportsTabs=[...document.querySelectorAll('.esports-tab')];
function selectEsport(tab){
  esportsTabs.forEach(button=>{
    const active=button===tab;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;
    $(button.getAttribute('aria-controls')).hidden=!active;
  });
  if(tab.dataset.esport==='general')showGameInventory();
}
esportsTabs.forEach((tab,index)=>{
  tab.addEventListener('click',()=>selectEsport(tab));
  tab.addEventListener('keydown',event=>{
    let next=null;
    if(event.key==='ArrowRight')next=(index+1)%esportsTabs.length;
    if(event.key==='ArrowLeft')next=(index+esportsTabs.length-1)%esportsTabs.length;
    if(event.key==='Home')next=0;
    if(event.key==='End')next=esportsTabs.length-1;
    if(next!==null){event.preventDefault();selectEsport(esportsTabs[next]);esportsTabs[next].focus();}
  });
});

function setState(message){$('data-state').lastElementChild.textContent=message;}
function renderRank(profile){
  const medal=$('rank-medal');
  medal.hidden=profile?.rankTier!==80;
  if(medal.hidden)return;
  const rank=Number.isInteger(profile.leaderboardRank)&&profile.leaderboardRank>0?profile.leaderboardRank:null;
  const tier=rank&&rank<=10?'8c':rank&&rank<=100?'8b':'8';
  const label=`Immortal${rank?`, leaderboard rank ${number.format(rank)}`:''}`;
  const img=$('rank-medal-image');img.hidden=false;medal.classList.remove('image-unavailable');
  img.onerror=()=>{img.hidden=true;medal.classList.add('image-unavailable');$('rank-number').textContent=label;};
  img.src=`https://www.opendota.com/assets/images/dota2/rank_icons/rank_icon_${tier}.png`;
  medal.setAttribute('aria-label',label);medal.title=label;$('rank-number').textContent=rank?String(rank):'';
}
async function loadStratzKda(){
  try{
    const response=await fetch('./stratz-kda.json');if(!response.ok)throw new Error('STRATZ snapshot unavailable');
    const data=await response.json();if(data.accountId!==ACCOUNT_ID||!Array.isArray(data.heroes))throw new Error('Invalid STRATZ snapshot');
    stratzKda=new Map(data.heroes.filter(hero=>Number.isInteger(hero.heroId)&&[hero.kills,hero.deaths,hero.assists].every(value=>Number.isInteger(value)&&value>=0)).map(hero=>[hero.heroId,[hero.kills,hero.deaths,hero.assists]]));
    const providedAt=new Date(`${data.providedAt}T12:00:00Z`);
    if(Number.isFinite(providedAt.getTime()))stratzProvidedAt=providedAt.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
  }catch{stratzKda=new Map();}
}
function renderHeroTable(){
  const heroes=currentStats?.heroes||[];
  const tbody=$('hero-body');tbody.replaceChildren();
  const visible=allHeroesShown?heroes:heroes.slice(0,5);
  visible.forEach(hero=>{
    const row=el('tr');const name=el('td');const cell=el('div','hero-cell');
    if(safeUrl(hero.heroImage)){
      const img=el('img','hero-portrait');img.src=hero.heroImage;img.alt='';img.loading='lazy';img.addEventListener('error',()=>img.remove(),{once:true});cell.append(img);
    }
    cell.append(el('span','',hero.hero));name.append(cell);row.append(name);
    row.append(el('td','',number.format(hero.games)),el('td','',Number.isFinite(hero.winrate)?`${hero.winrate.toFixed(2)}%`:'—'));
    const averages=stratzKda.get(hero.heroId);
    const kda=el('td','hero-kda',averages?averages.join(' / '):'—');
    row.append(kda);tbody.append(row);
  });
  if(!visible.length){const row=el('tr');const cell=el('td','hero-empty','No public hero statistics are available.');cell.colSpan=4;row.append(cell);tbody.append(row);}
  const toggle=$('toggle-heroes');toggle.hidden=heroes.length<=5;toggle.setAttribute('aria-expanded',String(allHeroesShown));toggle.textContent=allHeroesShown?'Show fewer heroes':`Show all ${heroes.length} heroes`;
  const coverage=currentStats?.coverage;
  let scope='Public matches on this account, including Turbo.';
  if(Number.isFinite(coverage?.identifiedHeroMatches)){
    scope=`${number.format(coverage.identifiedHeroMatches)} matches with identified heroes on this account, including Turbo.`;
    if(coverage.unidentifiedHeroMatches)scope+=` ${number.format(coverage.unidentifiedHeroMatches)} unidentified records excluded.`;
  }
  $('hero-coverage').textContent=`${scope} K / D / A: ${stratzKda.size?`STRATZ${stratzProvidedAt?` (${stratzProvidedAt})`:''}`:'unavailable'}.`;
}
$('toggle-heroes').addEventListener('click',()=>{allHeroesShown=!allHeroesShown;renderHeroTable();});
function renderStats(stats,source){
  currentStats=stats;
  $('player-name').textContent=stats.profile?.name||'Shihao Wang';
  renderRank(stats.profile);
  if(safeUrl(stats.profile?.avatar)){
    const avatar=el('img');avatar.src=stats.profile.avatar;avatar.alt='';avatar.addEventListener('error',()=>avatar.remove(),{once:true});$('player-avatar').replaceChildren(avatar);
  }
  $('stat-total').textContent=Number.isFinite(stats.total)?number.format(stats.total):'—';
  $('stat-rate').textContent=Number.isFinite(stats.winrate)?`${stats.winrate.toFixed(1)}%`:'—';
  $('stat-wins').textContent=Number.isFinite(stats.win)?number.format(stats.win):'—';
  $('stat-losses').textContent=Number.isFinite(stats.lose)?number.format(stats.lose):'—';
  renderHeroTable();
  const timestamp=new Date(stats.updatedAt);const updated=Number.isFinite(timestamp.getTime())?timestamp.toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}):'Time unavailable';
  setState(source==='live'?'Updated from OpenDota':'Saved OpenDota snapshot');
  $('stats-message').textContent=`${source==='live'?'Updated':'Snapshot'} ${updated}. Public records from OpenDota; private matches and other accounts are not included.`;
}
async function refreshStats(){
  if(refreshPending)return;refreshPending=true;setState('Updating from OpenDota');
  const loadingNotice=setTimeout(()=>{setState('Still loading from OpenDota');if(!currentStats)$('stats-message').textContent='OpenDota can take a little longer. Statistics will appear automatically.';},12000);
  try{
    const stats=await fetchDotaStats(ACCOUNT_ID);renderStats(stats,'live');
    try{localStorage.setItem(CACHE_KEY,JSON.stringify(stats));}catch{}
  }catch(error){
    if(currentStats){renderStats(currentStats,'cached');setState('Showing saved statistics');}
    else{$('stats-message').textContent='OpenDota is temporarily unavailable. Public records are available through the profile link above.';renderHeroTable();setState('Data temporarily unavailable');}
  }finally{clearTimeout(loadingNotice);refreshPending=false;}
}
async function initStats(){
  await loadStratzKda();
  let cached=null;let bundled=false;try{cached=JSON.parse(localStorage.getItem(CACHE_KEY)||'null');}catch{}
  if(cached?.accountId===ACCOUNT_ID&&cached.updatedAt&&Array.isArray(cached.heroes))renderStats(cached,'cached');
  else{try{const response=await fetch('./dota-snapshot.json');if(response.ok){const snapshot=await response.json();if(snapshot?.accountId===ACCOUNT_ID&&snapshot.updatedAt&&Array.isArray(snapshot.heroes)){renderStats(snapshot,'cached');bundled=true;}}}catch{}}
  if(bundled||!currentStats||Date.now()-Date.parse(currentStats.updatedAt)>10*60*1000)await refreshStats();
}
loadPublications();initStats();
