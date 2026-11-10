'use strict';

const $ = id => document.getElementById(id);
const euro = value => new Intl.NumberFormat('ru-RU', {style:'currency',currency:'EUR'}).format(value);
const number = value => new Intl.NumberFormat('ru-RU').format(value);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const normalize = value => String(value ?? '').normalize('NFKD').replace(/\p{Diacritic}/gu,'').toLowerCase();
const state = {store:'all',category:'',query:'',priced:true,sort:'default',limit:40,products:[],filtered:[],favorites:new Set()};
const map = new Map();
let meta, searchTimer, lastFocus;

const scope = {
  all:'Coop — каталог Витербо. Conad — общий каталог. Lidl — Lidl Everli. Eurospin — онлайн-каталог; местные цены уточняйте.',
  Coop:'Coop Viterbo De Lellis · самовывоз. Обычная цена показана крупно; цена по карте указана отдельно.',
  Conad:'Открытый общий каталог. Цена и наличие конкретного магазина Витербо не подтверждены.',
  Lidl:'Ассортимент и цены Lidl Everli. Доступность зависит от выбранной зоны обслуживания.',
  Eurospin:'Онлайн-каталог Eurospin. Наличие и цена в Витербо не подтверждены.'
};
const storeIcons = {Coop:'coop.ico',Conad:'conad.png',Lidl:'lidl.png',Eurospin:'eurospin.png'};
const categoryIcons = {fruit:'◒',vegetables:'♧',nuts:'◇',meat:'◖',deli:'≋',fish:'◁',dairy:'◧',cheese:'△',bread:'⌒',sweets:'◇',breakfast:'◉',pasta:'〰',pantry:'▤',baking:'⋰',ready:'▱',frozen:'❄',drinks:'◫',coffee:'☕',alcohol:'♙',special:'✧',kids:'☆',pets:'♧',care:'◍',cleaning:'✳',home:'⌂',clothes:'♢',garden:'✿',other:'▧'};

function imageMarkup(product, small=false) {
  if (!product.image) return `<span class="placeholder-art">EUROSPIN<small>ONLINE</small></span>`;
  if (product.direct_image) return `<div class="photo-window direct"><img src="${escapeHtml(product.image)}" alt="${small?'':escapeHtml(product.name_it)}" loading="lazy" decoding="async"></div>`;
  return `<div class="photo-window"><img src="${escapeHtml(product.image)}" alt="${small?'':escapeHtml(product.name_it)}" loading="lazy" decoding="async" style="width:${product.sprite_columns*100}%;height:${product.sprite_rows*100}%;left:-${product.sprite_x*100}%;top:-${product.sprite_y*100}%"></div>`;
}

function card(product) {
  const saved = state.favorites.has(product.key);
  const price = product.price ? euro(product.price) : 'Цена не опубликована';
  const member = product.member_price ? `<div class="member-offer"><span>С картой Coop</span><strong>${euro(product.member_price)}</strong><small>${escapeHtml(product.note?.split(' · ').slice(1).join(' · ') || '')}</small></div>` : '';
  const deal = product.member_price ? '' : /^-\d+%/.test(product.note || '') ? product.note.split(' · ')[0] : product.note === 'Акционная цена' ? 'Акция' : '';
  const extra = product.member_price ? '' : product.store === 'Coop' || product.store === 'Lidl' ? product.note || '' : '';
  return `<article class="product-card" data-key="${escapeHtml(product.key)}">
    <div class="product-media ${product.image?'':'no-image'}"><span class="store-badge ${product.store.toLowerCase()}"><img src="assets/store-icons/${storeIcons[product.store]}" alt="">${escapeHtml(product.store)}</span>${deal||product.member_price?`<span class="deal-badge">${escapeHtml(product.member_price?'С картой':deal)}</span>`:''}${imageMarkup(product)}<button class="favorite-button ${saved?'saved':''}" type="button" data-favorite="${escapeHtml(product.key)}" aria-label="${saved?'Удалить из избранного':'Добавить в избранное'}: ${escapeHtml(product.name_it)}" aria-pressed="${saved}">${saved?'♥':'♡'}</button></div>
    <div class="product-content"><span class="pack">${escapeHtml(product.pack || meta.categories.find(c=>c.id===product.category)?.name || '')}</span><h4 lang="it">${escapeHtml(product.name_it)}</h4><p class="russian-name">${escapeHtml(product.name_ru || '')}</p><div class="price-row"><span class="price ${product.price?'':'unpriced'}">${price}</span></div>${member}<span class="unit-price">${escapeHtml(product.unit_price || '')}</span>${extra?`<span class="offer-note">${escapeHtml(extra)}</span>`:''}</div>
  </article>`;
}

function matches(product, ignoreCategory=false) {
  return (state.store==='all' || product.store===state.store) &&
    (ignoreCategory || !state.category || product.category===state.category) &&
    (!state.priced || !!product.price) &&
    (!state.query || product._search.includes(normalize(state.query)));
}

function renderCategories() {
  const eligible = state.products.filter(product => matches(product,true));
  const counts = new Map();
  for (const product of eligible) counts.set(product.category,(counts.get(product.category)||0)+1);
  const categories = [{id:'',name:'Все товары',count:eligible.length},...meta.categories.map(category=>({...category,count:counts.get(category.id)||0}))];
  $('categories').innerHTML = categories.map(category=>`<button class="category ${state.category===category.id?'active':''}" type="button" data-category="${category.id}" aria-pressed="${state.category===category.id}"><span class="category-icon" aria-hidden="true">${category.id?categoryIcons[category.id]||'◇':'▦'}</span><span>${escapeHtml(category.name)}</span><small>${number(category.count)}</small></button>`).join('');
  $('mobileCategories').innerHTML = categories.filter(category=>category.count).map(category=>`<button class="mobile-category ${state.category===category.id?'active':''}" type="button" data-category="${category.id}" aria-pressed="${state.category===category.id}">${escapeHtml(category.name)}</button>`).join('');
}

function syncUrl() {
  const params = new URLSearchParams();
  if (state.store!=='all') params.set('store',state.store);
  if (state.category) params.set('category',state.category);
  if (state.query) params.set('q',state.query);
  if (!state.priced) params.set('allPrices','1');
  if (state.sort!=='default') params.set('sort',state.sort);
  history.replaceState(null,'',location.pathname+(params.size?'?'+params:''));
}

function render(reset=true) {
  if (!meta) return;
  if (reset) state.limit=40;
  state.filtered = state.products.filter(product=>matches(product));
  const rank = new Map(meta.categories.map((category,index)=>[category.id,index]));
  state.filtered.sort((a,b)=>{
    if (state.sort==='price-asc' || state.sort==='price-desc') {
      if (!a.price) return b.price?1:0;
      if (!b.price) return -1;
      return (a.price-b.price)*(state.sort==='price-desc'?-1:1);
    }
    if (state.sort==='name') return a.name_it.localeCompare(b.name_it,'it');
    return (rank.get(a.category)??99)-(rank.get(b.category)??99) || a.name_it.localeCompare(b.name_it,'it');
  });
  $('products').innerHTML = state.filtered.slice(0,state.limit).map(card).join('');
  $('emptyState').hidden = !!state.filtered.length;
  $('categoryTitle').textContent = meta.categories.find(category=>category.id===state.category)?.name || 'Все товары';
  $('scopeLabel').textContent = state.store==='all'?'ВСЕ МАГАЗИНЫ':state.store.toUpperCase();
  $('scopeNote').textContent = scope[state.store];
  $('resultCount').textContent = `${number(state.filtered.length)} товаров`;
  $('shownCount').textContent = state.filtered.length?`Показано ${number(Math.min(state.limit,state.filtered.length))} из ${number(state.filtered.length)}`:'';
  $('loadMore').hidden = state.limit>=state.filtered.length;
  document.querySelectorAll('.store-tab').forEach(button=>{const active=button.dataset.store===state.store;button.classList.toggle('active',active);button.setAttribute('aria-pressed',active);});
  renderCategories();syncUrl();
}

function showToast(message) {
  $('toast').textContent=message;$('toast').hidden=false;
  clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>$('toast').hidden=true,2400);
}
function updateFavoriteCount() { $('favoriteCount').textContent=number(state.favorites.size); }
function toggleFavorite(key) {
  if (!map.has(key)) return;
  const added=!state.favorites.has(key);
  if (added) state.favorites.add(key); else state.favorites.delete(key);
  try { localStorage.setItem('spesa-viterbo-favorites-v1',JSON.stringify([...state.favorites])); }
  catch { showToast('Браузер не сохранил избранное'); }
  updateFavoriteCount();
  document.querySelectorAll('[data-favorite]').forEach(button=>{if(button.dataset.favorite!==key)return;button.classList.toggle('saved',added);button.setAttribute('aria-pressed',added);button.setAttribute('aria-label',`${added?'Удалить из избранного':'Добавить в избранное'}: ${map.get(key).name_it}`);button.textContent=added?'♥':'♡';});
  if (!$('favoritesDrawer').hidden) renderFavorites();
  showToast(added?'Добавлено в избранное':'Удалено из избранного');
}
function renderFavorites() {
  const products=[...state.favorites].map(key=>map.get(key)).filter(Boolean);
  $('favoriteItems').innerHTML=products.length?products.map(product=>`<article class="favorite-item"><div class="favorite-thumb ${product.image?'':'empty'}">${product.image?imageMarkup(product,true):'E'}</div><div><strong>${escapeHtml(product.name_it)}</strong><small>${escapeHtml(product.store)} · ${escapeHtml(product.pack||'')}</small><b>${product.price?euro(product.price):'Цена не опубликована'}</b></div><button type="button" data-favorite="${escapeHtml(product.key)}" aria-label="Удалить ${escapeHtml(product.name_it)} из избранного">×</button></article>`).join(''):'<div class="favorites-empty"><span>♡</span><h3>Здесь пока пусто</h3><p>Нажмите на сердечко у понравившегося товара.</p></div>';
}
function openFavorites() {lastFocus=document.activeElement;renderFavorites();$('drawerOverlay').hidden=false;$('favoritesDrawer').hidden=false;document.body.style.overflow='hidden';$('closeFavorites').focus();}
function closeFavorites() {$('drawerOverlay').hidden=true;$('favoritesDrawer').hidden=true;document.body.style.overflow='';lastFocus?.focus();}

document.addEventListener('click',event=>{
  const favorite=event.target.closest('[data-favorite]');if(favorite){toggleFavorite(favorite.dataset.favorite);return;}
  const open=event.target.closest('[data-open]');if(open){if(open.dataset.open==='favorites')openFavorites();else $('aboutDialog').showModal();return;}
  const store=event.target.closest('[data-store]');if(store){state.store=store.dataset.store;state.category='';render();return;}
  const category=event.target.closest('[data-category]');if(category){state.category=category.dataset.category;render();return;}
});
$('searchInput').addEventListener('input',event=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.query=event.target.value.trim();render();},160);});
$('onlyPriced').addEventListener('change',event=>{state.priced=event.target.checked;render();});
$('sortSelect').addEventListener('change',event=>{state.sort=event.target.value;render();});
$('loadMore').addEventListener('click',()=>{state.limit+=40;render(false);});
$('resetFilters').addEventListener('click',()=>{Object.assign(state,{store:'all',category:'',query:'',priced:true,sort:'default'});$('searchInput').value='';$('onlyPriced').checked=true;$('sortSelect').value='default';render();});
$('closeFavorites').addEventListener('click',closeFavorites);
$('drawerOverlay').addEventListener('click',closeFavorites);
$('closeAbout').addEventListener('click',()=>$('aboutDialog').close());
$('aboutDialog').addEventListener('click',event=>{if(event.target===$('aboutDialog'))$('aboutDialog').close();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('favoritesDrawer').hidden)closeFavorites();});

(async()=>{
  try {
    const responses=await Promise.all(['meta.json','products.json','lidl-products.json','eurospin-products.json'].map(path=>fetch(path)));
    if(responses.some(response=>!response.ok))throw new Error('Catalog data unavailable');
    const [metadata,products,lidlProducts,eurospinProducts]=await Promise.all(responses.map(response=>response.json()));
    meta=metadata;state.products=[...products,...lidlProducts,...eurospinProducts];
    state.products.forEach(product=>{product._search=normalize([product.name_it,product.name_ru,product.store].join(' '));map.set(product.key,product);});
    try{const saved=JSON.parse(localStorage.getItem('spesa-viterbo-favorites-v1')||'[]');state.favorites=new Set(Array.isArray(saved)?saved.filter(key=>map.has(key)):[]);}catch{}
    const params=new URLSearchParams(location.search);
    if(['Coop','Conad','Lidl','Eurospin'].includes(params.get('store')))state.store=params.get('store');
    if(meta.categories.some(category=>category.id===params.get('category')))state.category=params.get('category');
    if(['price-asc','price-desc','name'].includes(params.get('sort')))state.sort=params.get('sort');
    state.query=params.get('q')||'';state.priced=params.get('allPrices')!=='1';
    $('searchInput').value=state.query;$('onlyPriced').checked=state.priced;$('sortSelect').value=state.sort;
    $('totalCount').textContent=number(state.products.length)+' товаров';
    $('allStoreCount').textContent=number(state.products.length)+' товаров';
    for(const store of ['Coop','Conad','Lidl','Eurospin'])$(''+store.toLowerCase()+'Count').textContent=number(state.products.filter(product=>product.store===store).length)+' товаров';
    updateFavoriteCount();render();
  } catch(error) {
    console.error(error);
    $('products').innerHTML='<p class="loading">Не удалось загрузить каталог. Обновите страницу.</p>';
    $('resultCount').textContent='Ошибка загрузки';
  }
})();
