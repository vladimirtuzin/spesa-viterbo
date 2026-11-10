'use strict';

const $ = id => document.getElementById(id);
const euro = value => new Intl.NumberFormat('ru-RU', {style:'currency',currency:'EUR'}).format(value);
const number = value => new Intl.NumberFormat('ru-RU').format(value);
const productCount = value => `${number(value)} ${({one:'товар',few:'товара',many:'товаров'})[new Intl.PluralRules('ru').select(value)]}`;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const normalize = value => String(value ?? '').normalize('NFKD').replace(/\p{Diacritic}/gu,'').toLowerCase();
function cleanCatalogName(product) {
  if (product.store !== 'Coop') return;
  const original = product.name_it;
  const freshCodes = !['care','cleaning','home','clothes','garden','pets'].includes(product.category) &&
    /\b(?:es|it)\s+\d+(?:[-/]\d+|\+)?(?=\s|$|i{1,2}\^)|\bi{1,2}\^|\bsf\b/i.test(original);
  const packageCodes = /\b(?:bs|btg|vtbg|vs|vh|ct|rt|mz|jsk)\b/i;
  if (!freshCodes && !packageCodes.test(original) && !/f\.lli\s+orsero/i.test(original)) return;
  const clean = name => {
    let result = name.replace(/\bf\.lli\s+orsero\b/gi, 'Orsero');
    if (freshCodes) result = result
      .replace(/\b(?:es|it)\s+\d+(?:[-/]\d+|\+)?(?=\s|$|i{1,2}\^)/gi, '')
      .replace(/\b(?:es|it)\s+(?=i{1,2}\^)/gi, '')
      .replace(/\bi{1,2}\^/gi, '')
      .replace(/\b(?:es|it)(?=\s+(?:bs|btg|vtbg|vs|vh|ct|rt|mz|jsk)\b)/gi, '');
    return result.replace(/\b(?:sf|bs|btg|vtbg|vs|vh|ct|rt|mz|jsk)\b\.?/gi, '')
      .replace(/\s+/g, ' ').trim();
  };
  product.name_it = clean(original);
  product.name_ru = product.key === 'coop-1258361' ? 'Ананас Gold Orsero' : freshCodes ? '' : clean(product.name_ru || '')
    .replace(/\b(?:бсг?|бтг|втбг|вх|кт|рт|мз)\b\.?/gi, '')
    .replace(/\s+/g, ' ').trim();
}
const state = {store:'all',category:'',query:'',priced:true,deals:false,sort:'default',limit:40,products:[],filtered:[],favorites:new Set()};
const map = new Map();
const infoCache = new Map();
let meta, searchTimer, lastFocus;
let infoFocus;

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
  const extra = product.member_price ? '' : product.store === 'Coop' || product.store === 'Lidl' ? product.note || '' : '';
  return `<article class="product-card" data-key="${escapeHtml(product.key)}">
    <div class="product-media ${product.image?'':'no-image'}">${imageMarkup(product)}${product.store==='Lidl'?'':`<button class="info-button" type="button" data-info="${escapeHtml(product.key)}" aria-label="Состав и пищевая ценность: ${escapeHtml(product.name_it)}">i</button>`}<button class="favorite-button ${saved?'saved':''}" type="button" data-favorite="${escapeHtml(product.key)}" aria-label="${saved?'Удалить из избранного':'Добавить в избранное'}: ${escapeHtml(product.name_it)}" aria-pressed="${saved}">${saved?'♥':'♡'}</button></div>
    <div class="product-content"><span class="store-line"><img src="assets/store-icons/${storeIcons[product.store]}" alt="">${escapeHtml(product.store)}</span><span class="pack">${escapeHtml(product.pack || meta.categories.find(c=>c.id===product.category)?.name || '')}</span><h4 lang="it">${escapeHtml(product.name_it)}</h4><p class="russian-name">${escapeHtml(product.name_ru || '')}</p><div class="price-row"><span class="price ${product.price?'':'unpriced'}">${price}</span></div>${member}<span class="unit-price">${escapeHtml(product.unit_price || '')}</span>${extra?`<span class="offer-note">${escapeHtml(extra)}</span>`:''}</div>
  </article>`;
}

function isDeal(product) {
  return !!product.price && !product.future && !product.expired &&
    (!!product.member_price || /^-\d+%/.test(product.note || '') || product.note === 'Акционная цена');
}

function matches(product, ignoreCategory=false) {
  return (state.store==='all' || product.store===state.store) &&
    (ignoreCategory || !state.category || product.category===state.category) &&
    (!state.priced || !!product.price) &&
    (!state.deals || isDeal(product)) &&
    (!state.query || product._search.includes(normalize(state.query)));
}

function renderCategories() {
  const eligible = state.products.filter(product => matches(product,true));
  const counts = new Map();
  for (const product of eligible) counts.set(product.category,(counts.get(product.category)||0)+1);
  const categories = [{id:'',name:state.deals?'Все скидки':'Все товары',count:eligible.length},...meta.categories.map(category=>({...category,count:counts.get(category.id)||0}))];
  $('categories').innerHTML = categories.map(category=>`<button class="category ${state.category===category.id?'active':''}" type="button" data-category="${category.id}" aria-pressed="${state.category===category.id}"><span class="category-icon" aria-hidden="true">${category.id?categoryIcons[category.id]||'◇':'▦'}</span><span>${escapeHtml(category.name)}</span><small>${number(category.count)}</small></button>`).join('');
  $('mobileCategories').innerHTML = categories.filter(category=>category.count).map(category=>`<button class="mobile-category ${state.category===category.id?'active':''}" type="button" data-category="${category.id}" aria-pressed="${state.category===category.id}">${escapeHtml(category.name)}</button>`).join('');
}

function syncUrl() {
  const params = new URLSearchParams();
  if (state.store!=='all') params.set('store',state.store);
  if (state.category) params.set('category',state.category);
  if (state.query) params.set('q',state.query);
  if (state.deals) params.set('offers','1');
  if (!state.priced) params.set('allPrices','1');
  if (state.sort!=='default') params.set('sort',state.sort);
  history.replaceState(null,'',location.pathname+(params.size?'?'+params:''));
}

function updatePagination() {
  const total=state.filtered.length;
  const shown=Math.min(state.limit,total);
  $('shownCount').textContent=total?`Показано ${number(shown)} из ${number(total)} · ${Math.ceil(shown/40)} из ${Math.ceil(total/40)} страниц`:'';
  $('pageProgress').style.width=total?`${shown/total*100}%`:'0%';
  $('loadMore').hidden=shown>=total;
  if (shown<total) $('loadMore').innerHTML=`Показать ещё ${productCount(Math.min(40,total-shown))} <span>Страница ${Math.floor(shown/40)+1} ↓</span>`;
}
function showMore() {
  const start=state.limit;
  state.limit+=40;
  $('products').insertAdjacentHTML('beforeend',state.filtered.slice(start,state.limit).map(card).join(''));
  updatePagination();
}
function render() {
  if (!meta) return;
  state.limit=40;
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
  $('emptyState').querySelector('h3').textContent = state.deals ? 'Скидок не найдено' : 'Пока ничего не нашлось';
  $('emptyState').querySelector('p').textContent = state.deals ? 'В этом разделе или магазине нет опубликованных предложений. Попробуйте другой фильтр.' : 'Попробуйте другое название или откройте все разделы.';
  const categoryName=meta.categories.find(category=>category.id===state.category)?.name;
  $('categoryTitle').textContent = state.deals ? categoryName ? `Скидки · ${categoryName}` : 'Скидки' : categoryName || 'Все товары';
  $('scopeLabel').textContent = state.store==='all'?'ВСЕ МАГАЗИНЫ':state.store.toUpperCase();
  $('scopeNote').textContent = state.deals ? 'Акции и цены по карте из открытых каталогов.' : scope[state.store];
  $('resultCount').textContent = productCount(state.filtered.length);
  updatePagination();
  $('onlyOffers').checked=state.deals;
  document.querySelectorAll('[data-view]').forEach(button=>{const active=(button.dataset.view==='offers')===state.deals;button.classList.toggle('active',active);button.setAttribute('aria-pressed',active);});
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
function renderInfo(info) {
  const paragraphs = [];
  if (info.ingredients) paragraphs.push(`<section><h3>Состав</h3><p class="info-ingredients" lang="it">${escapeHtml(info.ingredients).replace(/\n/g,'<br>')}</p></section>`);
  if (info.allergens) paragraphs.push(`<section><h3>Аллергены</h3><p lang="it">${escapeHtml(info.allergens).replace(/\n/g,'<br>')}</p></section>`);
  if (info.nutrition?.rows?.length) {
    const headers = info.nutrition.headers.map(value=>`<th scope="col">${escapeHtml(value)}</th>`).join('');
    const rows = info.nutrition.rows.map(row=>`<tr>${row.map((value,index)=>index?`<td>${escapeHtml(value??'')}</td>`:`<th scope="row">${escapeHtml(value??'')}</th>`).join('')}</tr>`).join('');
    paragraphs.push(`<section><h3>Пищевая ценность</h3><div class="info-table-scroll"><table lang="it"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table></div></section>`);
  }
  $('infoContent').innerHTML = paragraphs.length ? paragraphs.join('')+'<p class="info-footnote">Данные магазина могут измениться. Проверяйте состав и аллергены на упаковке.</p>' : '<p class="info-empty">Магазин не опубликовал состав или пищевую ценность этого товара.</p>';
}
async function openInfo(key) {
  const product = map.get(key);
  if (!product) return;
  infoFocus = document.activeElement;
  $('infoTitle').textContent = product.name_it;
  $('infoStore').textContent = product.store.toUpperCase()+' · '+(product.pack||'').trim();
  $('infoContent').innerHTML = '<p class="info-loading">Загружаем данные товара…</p>';
  $('infoDialog').dataset.key = key;
  $('infoDialog').showModal();
  $('closeInfo').focus();
  try {
    let info = infoCache.get(key);
    if (!info) {
      const params = new URLSearchParams({store:product.store,url:product.url||'',key});
      const response = await fetch('api/info?'+params);
      if (!response.ok) throw new Error('Product info unavailable');
      info = await response.json();
      infoCache.set(key,info);
    }
    if (info.image && product.store === 'Coop' && !product.direct_image) {
      product.image = info.image;
      product.direct_image = true;
      document.querySelectorAll('.product-card').forEach(card=>{
        if (card.dataset.key === key) {
          const photo = card.querySelector('.photo-window');
          if (photo) photo.outerHTML = imageMarkup(product);
        }
      });
    }
    if ($('infoDialog').open && $('infoDialog').dataset.key === key) renderInfo(info);
  } catch {
    if ($('infoDialog').open && $('infoDialog').dataset.key === key) $('infoContent').innerHTML = '<p class="info-empty">Сейчас не удалось загрузить данные товара. Попробуйте ещё раз позже.</p>';
  }
}
function openFavorites() {lastFocus=document.activeElement;renderFavorites();$('drawerOverlay').hidden=false;$('favoritesDrawer').hidden=false;document.body.style.overflow='hidden';$('closeFavorites').focus();}
function closeFavorites() {$('drawerOverlay').hidden=true;$('favoritesDrawer').hidden=true;document.body.style.overflow='';lastFocus?.focus();}

document.addEventListener('click',event=>{
  const info=event.target.closest('[data-info]');if(info){openInfo(info.dataset.info);return;}
  const favorite=event.target.closest('[data-favorite]');if(favorite){toggleFavorite(favorite.dataset.favorite);return;}
  const open=event.target.closest('[data-open]');if(open){if(open.dataset.open==='favorites')openFavorites();else $('aboutDialog').showModal();return;}
  const view=event.target.closest('[data-view]');if(view){state.deals=view.dataset.view==='offers';state.category='';render();return;}
  const store=event.target.closest('[data-store]');if(store){state.store=store.dataset.store;state.category='';render();return;}
  const category=event.target.closest('[data-category]');if(category){state.category=category.dataset.category;render();return;}
});
$('searchInput').addEventListener('input',event=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.query=event.target.value.trim();render();},160);});
$('onlyPriced').addEventListener('change',event=>{state.priced=event.target.checked;render();});
$('onlyOffers').addEventListener('change',event=>{state.deals=event.target.checked;render();});
$('sortSelect').addEventListener('change',event=>{state.sort=event.target.value;render();});
$('loadMore').addEventListener('click',showMore);
$('resetFilters').addEventListener('click',()=>{Object.assign(state,{store:'all',category:'',query:'',priced:true,deals:false,sort:'default'});$('searchInput').value='';$('onlyPriced').checked=true;$('sortSelect').value='default';render();});
$('closeFavorites').addEventListener('click',closeFavorites);
$('drawerOverlay').addEventListener('click',closeFavorites);
$('closeAbout').addEventListener('click',()=>$('aboutDialog').close());
$('aboutDialog').addEventListener('click',event=>{if(event.target===$('aboutDialog'))$('aboutDialog').close();});
$('closeInfo').addEventListener('click',()=>$('infoDialog').close());
$('infoDialog').addEventListener('click',event=>{if(event.target===$('infoDialog'))$('infoDialog').close();});
$('infoDialog').addEventListener('close',()=>infoFocus?.focus());
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('favoritesDrawer').hidden)closeFavorites();});

(async()=>{
  try {
    const responses=await Promise.all(['meta.json','products.json','lidl-products.json','eurospin-products.json','coop-images.json'].map(path=>fetch(path)));
    if(responses.some(response=>!response.ok))throw new Error('Catalog data unavailable');
    const [metadata,products,lidlProducts,eurospinProducts,coopImages]=await Promise.all(responses.map(response=>response.json()));
    meta=metadata;state.products=[...products,...lidlProducts,...eurospinProducts];
    state.products.forEach(product=>{if(product.store==='Coop'&&coopImages[product.key]){product.image=coopImages[product.key];product.direct_image=true;}cleanCatalogName(product);product._search=normalize([product.name_it,product.name_ru,product.store].join(' '));map.set(product.key,product);});
    try{const saved=JSON.parse(localStorage.getItem('spesa-viterbo-favorites-v1')||'[]');state.favorites=new Set(Array.isArray(saved)?saved.filter(key=>map.has(key)):[]);}catch{}
    const params=new URLSearchParams(location.search);
    if(['Coop','Conad','Lidl','Eurospin'].includes(params.get('store')))state.store=params.get('store');
    if(meta.categories.some(category=>category.id===params.get('category')))state.category=params.get('category');
    if(['price-asc','price-desc','name'].includes(params.get('sort')))state.sort=params.get('sort');
    state.deals=params.get('offers')==='1';
    state.query=params.get('q')||'';state.priced=params.get('allPrices')!=='1';
    $('searchInput').value=state.query;$('onlyPriced').checked=state.priced;$('sortSelect').value=state.sort;
    $('totalCount').textContent=productCount(state.products.length);
    $('allStoreCount').textContent=productCount(state.products.length);
    $('offerTotalCount').textContent=number(state.products.filter(isDeal).length);
    for(const store of ['Coop','Conad','Lidl','Eurospin'])$(''+store.toLowerCase()+'Count').textContent=productCount(state.products.filter(product=>product.store===store).length);
    updateFavoriteCount();render();
  } catch(error) {
    console.error(error);
    $('products').innerHTML='<p class="loading">Не удалось загрузить каталог. Обновите страницу.</p>';
    $('resultCount').textContent='Ошибка загрузки';
  }
})();
