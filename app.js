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
const state = {store:'all',category:'',query:'',deals:false,pp:false,noSugar:false,lactoseFree:false,sugarMax:'',fatMax:'',sort:'default',limit:40,products:[],filtered:[],favorites:new Set(),cart:new Map()};
const map = new Map();
const infoCache = new Map();
const infoShards = new Map();
let meta, infoIndex, searchTimer, lastFocus;
let infoFocus;

const storeIcons = {Coop:'coop.ico',Conad:'conad.png',Lidl:'lidl.png',Eurospin:'eurospin.png'};
const heart = saved => `<svg viewBox="0 0 24 24" aria-hidden="true"${saved?' class="filled"':''}><path d="M20.8 4.6a5.4 5.4 0 0 0-7.7 0L12 5.7l-1.1-1.1a5.4 5.4 0 0 0-7.7 7.6L12 21l8.8-8.8a5.4 5.4 0 0 0 0-7.6Z"/></svg>`;
const infoIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v6M12 7v.5"/></svg>';
const cartIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 3h3l2.1 12h12.4l2-9H6"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/></svg>';

function imageMarkup(product, small=false) {
  if (!product.image) return '<span class="placeholder-art"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="m4 17 5-5 4 4 3-3 5 5"/><circle cx="15" cy="8" r="2"/></svg><small>Нет изображения</small></span>';
  if (product.direct_image) return `<div class="photo-window direct"><img src="${escapeHtml(product.image)}" alt="${small?'':escapeHtml(product.name_it)}" loading="lazy" decoding="async"></div>`;
  return `<div class="photo-window"><img src="${escapeHtml(product.image)}" alt="${small?'':escapeHtml(product.name_it)}" loading="lazy" decoding="async" style="width:${product.sprite_columns*100}%;height:${product.sprite_rows*100}%;left:-${product.sprite_x*100}%;top:-${product.sprite_y*100}%"></div>`;
}

function card(product) {
  const saved = state.favorites.has(product.key);
  const price = product.price ? euro(product.price) : 'Цена не опубликована';
  const member = product.member_price ? `<div class="member-offer"><span>С картой Coop</span><strong>${euro(product.member_price)}</strong><small>${escapeHtml(product.note?.split(' · ').slice(1).join(' · ') || '')}</small></div>` : '';
  const extra = product.member_price ? '' : product.store === 'Coop' || product.store === 'Lidl' ? product.note || '' : '';
  return `<article class="product-card ${product._hasInfo?'has-specs':''}" data-key="${escapeHtml(product.key)}">
    <div class="product-media ${product.image?'':'no-image'}">${imageMarkup(product)}<span class="card-store"><img src="assets/store-icons/${storeIcons[product.store]}" alt="">${escapeHtml(product.store)}</span><div class="card-actions">${product._hasInfo?`<button class="info-button" type="button" data-info="${escapeHtml(product.key)}" aria-label="Состав и пищевая ценность: ${escapeHtml(product.name_it)}">${infoIcon}</button>`:''}<button class="favorite-button ${saved?'saved':''}" type="button" data-favorite="${escapeHtml(product.key)}" aria-label="${saved?'Удалить из избранного':'Добавить в избранное'}: ${escapeHtml(product.name_it)}" aria-pressed="${saved}">${heart(saved)}</button></div></div>
    <div class="product-content"><span class="pack">${escapeHtml(product.pack || meta.categories.find(c=>c.id===product.category)?.name || '')}</span><h4 lang="it">${escapeHtml(product.name_it)}</h4><p class="russian-name">${escapeHtml(product.name_ru || '')}</p><div class="price-row"><span class="price ${product.price?'':'unpriced'}">${price}</span></div>${member}<span class="unit-price">${escapeHtml(product.unit_price || '')}</span>${extra?`<span class="offer-note">${escapeHtml(extra)}</span>`:''}<div class="cart-card-control" data-cart-control="${escapeHtml(product.key)}">${cartControl(product)}</div></div>
    ${product._hasInfo?`<div class="product-specs"><strong>Характеристики</strong><div class="spec-scroll" data-spec-content><p>Загружаем…</p></div><button class="text-button" type="button" data-full-info="${escapeHtml(product.key)}">Открыть полностью</button></div>`:''}
  </article>`;
}
function cartControl(product) {
  const quantity=state.cart.get(product.key)||0;
  const key=escapeHtml(product.key);
  return quantity?`<div class="card-quantity"><button type="button" data-cart-change="${key}" data-delta="-1" aria-label="Уменьшить количество: ${escapeHtml(product.name_it)}">−</button><button type="button" data-open="cart" class="quantity-status">${quantity} в кошике</button><button type="button" data-cart-change="${key}" data-delta="1" aria-label="Увеличить количество: ${escapeHtml(product.name_it)}">+</button></div>`:`<button type="button" class="add-cart" data-add-cart="${key}">${cartIcon}<span>Добавить в кошик</span></button>`;
}

function updateCartCount() {$('cartCount').textContent=number([...state.cart.values()].reduce((sum,quantity)=>sum+quantity,0));}
function setCartQuantity(key,quantity) {
  if(!map.has(key))return;
  const active=document.activeElement;
  const wasInDrawer=active?.closest('#cartDrawer');
  const focusDelta=active?.dataset.cartChange?active.dataset.delta:active?.dataset.addCart?'1':null;
  const removed=active?.hasAttribute('data-cart-remove');
  quantity=Math.max(0,Math.min(999,Math.trunc(quantity)));
  if(quantity)state.cart.set(key,quantity);else state.cart.delete(key);
  try{localStorage.setItem('shopping-by-tuzin-cart-v1',JSON.stringify([...state.cart]));}catch{showToast('Браузер не сохранил корзину');}
  updateCartCount();
  document.querySelectorAll('[data-cart-control]').forEach(element=>{if(element.dataset.cartControl===key)element.innerHTML=cartControl(map.get(key));});
  if(!$('cartDrawer').hidden)renderCart();
  if(focusDelta!==null) {
    const scope=wasInDrawer?$('cartDrawer'):$('products');
    const next=[...scope.querySelectorAll('[data-cart-change]')].find(button=>button.dataset.cartChange===key&&button.dataset.delta===focusDelta);
    const add=[...scope.querySelectorAll('[data-add-cart]')].find(button=>button.dataset.addCart===key);
    (next||add||$('closeCart')).focus({preventScroll:true});
  } else if(removed)($('cartItems').querySelector('[data-cart-remove]')||$('closeCart')).focus({preventScroll:true});
}
function renderCart() {
  const entries=[...state.cart].map(([key,quantity])=>({product:map.get(key),quantity})).filter(entry=>entry.product);
  const stores=[...new Set(entries.map(entry=>entry.product.store))];
  $('cartItems').innerHTML=entries.length?stores.map(store=>`<section class="cart-group"><h3><img src="assets/store-icons/${storeIcons[store]}" alt="">${escapeHtml(store)}</h3>${entries.filter(entry=>entry.product.store===store).map(({product,quantity})=>`<article class="cart-item"><div class="favorite-thumb">${imageMarkup(product,true)}</div><div class="cart-item-body"><strong>${escapeHtml(product.name_it)}</strong><small>${escapeHtml(product.pack||'')}</small><div class="cart-item-bottom"><div class="quantity-stepper"><button type="button" data-cart-change="${escapeHtml(product.key)}" data-delta="-1" aria-label="Уменьшить количество">−</button><output>${quantity}</output><button type="button" data-cart-change="${escapeHtml(product.key)}" data-delta="1" aria-label="Увеличить количество">+</button></div><b>${product.price?euro(product.price*quantity):'—'}</b></div></div><button class="remove-cart" type="button" data-cart-remove="${escapeHtml(product.key)}" aria-label="Удалить ${escapeHtml(product.name_it)} из корзины">×</button></article>`).join('')}</section>`).join(''):'<div class="favorites-empty"><span>'+cartIcon+'</span><h3>В корзине пока пусто</h3><p>Добавьте товары из каталога.</p></div>';
  $('cartFooter').hidden=!entries.length;
  $('cartTotal').textContent=euro(entries.reduce((sum,{product,quantity})=>sum+(product.price||0)*quantity,0));
  $('cartTotalLabel').textContent=entries.some(({product})=>!product.price)?'По опубликованным ценам':'Итого';
}

function isDeal(product) {
  return !!product.price && !product.future && !product.expired &&
    (!!product.member_price || /^-\d+%/.test(product.note || '') || product.note === 'Акционная цена');
}

function ppRank(product) {
  const a=product._attributes||{};
  if (product.category==='fruit'||product.category==='vegetables') {
    const label=`${product.name_it} ${product.pack||''}`;
    if (/sciropp|candit|disidrat|essiccat|conserv|confettur|marmellat|succo|salsa|sott.?olio|in olio|grigliat|fritt|chips|zuccherat|passata|vellutata|omogeneizzat|surgelat|zuppa|spremuta|sottaceto|agrodolce|acetelli|giardiniera|salamoia|vaso vetro|\bv\.\s*v\.|snack|gusto|precott|decorticat/i.test(label)) return null;
    const fresh=/\bcat\.?\s*[i1]\b|percorso qualità|fresc[oaie]|a peso|1 pz|\b(?:rete|mazzo|pezzo|vassoio|vaschetta)\b/i.test(label) || product.store==='Lidl'&&/\b(?:confezione|busta)\s+[\d.,]+\s*kg\b/i.test(product.pack||'')&&/^(?:cuori di iceberg|insalata|carote|valeriana|lattughino|lattuga|rucola|spinaci|pomodori|broccoli|cavolo|cavolfiore|cetrioli|peperoni|zucchine|melanzane|fagiolini|funghi|fragole|mirtilli|lamponi|uva|mele|pere|arance|mandarini|limoni|pesche|albicocche|banane|kiwi|avocado)\b/i.test(product.name_it);
    return fresh ? product.category==='vegetables'?0:20 : null;
  }
  if (a.kind==='yogurt'&&a.sugar_g!=null&&a.sugar_g<=5&&a.fat_g!=null&&a.fat_g<=5) return 100+a.sugar_g*10+a.fat_g;
  if (a.kind==='milk'&&a.fat_g!=null&&a.fat_g<=1.5) return 200+a.fat_g*10;
  if (a.kind==='soda'&&(a.sugar_free||a.sugar_g!=null&&a.sugar_g<=0.5)) return 300+(a.sugar_g||0);
  return null;
}

function matches(product, {ignoreCategory=false,ignoreStore=false,ignoreView=false,ignoreAttributes=false}={}) {
  const attributes=product._attributes||{};
  return (ignoreStore || state.store==='all' || product.store===state.store) &&
    (ignoreCategory || !state.category || product.category===state.category) &&
    !!product.price &&
    (ignoreView || !state.deals || isDeal(product)) &&
    (ignoreView || !state.pp || product._ppRank!=null) &&
    (ignoreAttributes || !state.noSugar || attributes.sugar_free) &&
    (ignoreAttributes || !state.lactoseFree || attributes.lactose_free) &&
    (ignoreAttributes || !state.sugarMax || attributes.sugar_g!=null && attributes.sugar_g<=Number(state.sugarMax)) &&
    (ignoreAttributes || !state.fatMax || attributes.fat_g!=null && attributes.fat_g<=Number(state.fatMax)) &&
    (!state.query || product._search.includes(normalize(state.query)));
}

function renderCategories() {
  const eligible = state.products.filter(product => matches(product,{ignoreCategory:true,ignoreAttributes:true}));
  const counts = new Map();
  for (const product of eligible) counts.set(product.category,(counts.get(product.category)||0)+1);
  const categories = [{id:'',name:state.deals?'Все скидки':state.pp?'Все ПП-товары':'Все товары',count:eligible.length},...meta.categories.map(category=>({...category,count:counts.get(category.id)||0}))];
  $('categories').innerHTML = categories.map(category=>`<button class="category ${state.category===category.id?'active':''} ${category.count?'':'no-results'}" type="button" data-category="${category.id}" aria-pressed="${state.category===category.id}"><span>${escapeHtml(category.name)}</span><small>${number(category.count)}</small></button>`).join('');
}

function syncUrl() {
  const params = new URLSearchParams();
  if (state.store!=='all') params.set('store',state.store);
  if (state.category) params.set('category',state.category);
  if (state.query) params.set('q',state.query);
  if (state.deals) params.set('offers','1');
  if (state.pp) params.set('pp','1');
  if (state.noSugar) params.set('noSugar','1');
  if (state.lactoseFree) params.set('lactoseFree','1');
  if (state.sugarMax) params.set('sugarMax',state.sugarMax);
  if (state.fatMax) params.set('fatMax',state.fatMax);
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
function renderCharacteristics() {
  const eligible=state.products.filter(product=>matches(product,{ignoreAttributes:true}));
  const sugar=eligible.some(product=>product._attributes?.sugar_g!=null)||!!state.sugarMax;
  const fat=eligible.some(product=>product._attributes?.fat_g!=null)||!!state.fatMax;
  const noSugar=eligible.some(product=>product._attributes?.sugar_free)||state.noSugar;
  const lactose=eligible.some(product=>product._attributes?.lactose_free)||state.lactoseFree;
  $('characterFilters').hidden=!state.category||!sugar&&!fat&&!noSugar&&!lactose;
  $('noSugarWrap').hidden=!noSugar;
  $('lactoseFreeWrap').hidden=!lactose;
  $('sugarMaxWrap').hidden=!sugar;
  $('fatMaxWrap').hidden=!fat;
  const basis=state.category==='drinks'?'100 мл':state.category==='dairy'?'100 г/мл':'100 г';
  $('sugarUnit').textContent=`Сахар / ${basis}`;
  $('fatUnit').textContent=`Жиры / ${basis}`;
  $('noSugar').checked=state.noSugar;
  $('lactoseFree').checked=state.lactoseFree;
  $('sugarMax').value=state.sugarMax;
  $('fatMax').value=state.fatMax;
  $('characterNote').hidden=!state.sugarMax&&!state.fatMax;
  $('openFilters').querySelector('span').textContent='Фильтры';
  const chosen=[state.noSugar,state.lactoseFree,!!state.sugarMax,!!state.fatMax].filter(Boolean).length;
  $('characterSelection').textContent=chosen?`Выбрано: ${chosen}`:'Сахар, жиры и состав';
  $('resetSidebar').hidden=state.store==='all'&&!state.category&&!state.query&&!chosen&&state.sort==='default';
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
    if (state.pp) return a._ppRank-b._ppRank || a.name_it.localeCompare(b.name_it,'it');
    return (rank.get(a.category)??99)-(rank.get(b.category)??99) || a.name_it.localeCompare(b.name_it,'it');
  });
  if (state.pp&&state.sort==='default') {
    const groups=[[],[],[],[],[]];
    for (const product of state.filtered) groups[product._ppRank===0?0:product._ppRank===20?1:Math.floor(product._ppRank/100)+1].push(product);
    state.filtered=Array.from({length:Math.max(...groups.map(group=>group.length))},(_,index)=>groups.map(group=>group[index]).filter(Boolean)).flat();
  }
  $('products').innerHTML = state.filtered.slice(0,state.limit).map(card).join('');
  const storeCounts=new Map();
  for(const product of state.products)if(matches(product,{ignoreStore:true}))storeCounts.set(product.store,(storeCounts.get(product.store)||0)+1);
  $('allStoreCount').textContent=productCount([...storeCounts.values()].reduce((sum,count)=>sum+count,0));
  for(const store of ['Coop','Conad','Lidl','Eurospin'])$(''+store.toLowerCase()+'Count').textContent=productCount(storeCounts.get(store)||0);
  $('offerTotalCount').textContent=number(state.products.filter(product=>isDeal(product)&&matches(product,{ignoreView:true})).length);
  $('ppTotalCount').textContent=number(state.products.filter(product=>product._ppRank!=null&&matches(product,{ignoreView:true})).length);
  $('emptyState').hidden = !!state.filtered.length;
  $('emptyState').querySelector('h3').textContent = state.deals ? 'Скидок не найдено' : state.pp ? 'Подходящих товаров не найдено' : 'Пока ничего не нашлось';
  $('emptyState').querySelector('p').textContent = state.deals ? 'В этом разделе или магазине нет опубликованных предложений. Попробуйте другой фильтр.' : 'Попробуйте другое название или откройте все разделы.';
  const categoryName=meta.categories.find(category=>category.id===state.category)?.name;
  const title=categoryName||'Все товары';
  $('categoryTitle').textContent = state.deals ? title==='Все товары'?'Скидки':`Скидки · ${title}` : state.pp ? title==='Все товары'?'ПП':`ПП · ${title}` : title;
  $('resultCount').textContent = productCount(state.filtered.length);
  $('sortSelect').options[0].textContent=state.pp?'По подборке':'По разделам';
  updatePagination();
  renderCharacteristics();
  document.querySelectorAll('[data-view]').forEach(button=>{const active=button.dataset.view===(state.deals?'offers':state.pp?'pp':'all');button.classList.toggle('active',active);button.setAttribute('aria-pressed',active);});
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
  document.querySelectorAll('.favorite-button[data-favorite]').forEach(button=>{if(button.dataset.favorite!==key)return;button.classList.toggle('saved',added);button.setAttribute('aria-pressed',added);button.setAttribute('aria-label',`${added?'Удалить из избранного':'Добавить в избранное'}: ${map.get(key).name_it}`);button.innerHTML=heart(added);});
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
async function savedProductInfo(key) {
  if (infoCache.has(key)) return infoCache.get(key);
  const shard=(Number(key.match(/\d+$/)[0])%64).toString(16).padStart(2,'0');
  if (!infoShards.has(shard)) {
    infoShards.set(shard,fetch(`data/product-info/${shard}.json?v=${infoIndex.version}`).then(response=>{
      if (!response.ok) throw new Error('Saved product info unavailable');
      return response.json();
    }).catch(error=>{infoShards.delete(shard);throw error;}));
  }
  const entry=(await infoShards.get(shard))[key];
  if (!entry?.info) throw new Error('Saved product info missing');
  infoCache.set(key,entry.info);
  return entry.info;
}
async function loadCardSpecs(element) {
  if (!element.classList.contains('has-specs')||element.dataset.specsLoaded) return;
  element.dataset.specsLoaded='loading';
  try {
    const info=await savedProductInfo(element.dataset.key);
    const blocks=[];
    if(info.nutrition?.rows?.length) {
      blocks.push(`<section><h5>Пищевая ценность</h5><p class="spec-basis">${escapeHtml(info.nutrition.headers[1]||'')}</p><dl>${info.nutrition.rows.filter(row=>row[1]).map(row=>`<div><dt>${escapeHtml(row[0])}</dt><dd>${escapeHtml(row[1])}</dd></div>`).join('')}</dl></section>`);
    }
    if(info.ingredients)blocks.push(`<section><h5>Состав</h5><p lang="it">${escapeHtml(info.ingredients).replace(/\n/g,'<br>')}</p></section>`);
    if(info.allergens)blocks.push(`<section><h5>Аллергены</h5><p lang="it">${escapeHtml(info.allergens)}</p></section>`);
    element.querySelector('[data-spec-content]').innerHTML=blocks.join('');
    element.dataset.specsLoaded='ready';
  } catch {
    element.querySelector('[data-spec-content]').innerHTML='<p>Не удалось открыть сохранённые данные.</p>';
    delete element.dataset.specsLoaded;
  }
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
    const info = await savedProductInfo(key);
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
    if ($('infoDialog').open && $('infoDialog').dataset.key === key) $('infoContent').innerHTML = '<p class="info-empty">Не удалось открыть сохранённые данные. Попробуйте ещё раз.</p>';
  }
}
function openDrawer(id) {lastFocus=document.activeElement;$('favoritesDrawer').hidden=true;$('cartDrawer').hidden=true;if(id==='cartDrawer')renderCart();else renderFavorites();$('drawerOverlay').hidden=false;$(id).hidden=false;document.body.style.overflow='hidden';$(id==='cartDrawer'?'closeCart':'closeFavorites').focus();}
function closeDrawer() {$('drawerOverlay').hidden=true;$('favoritesDrawer').hidden=true;$('cartDrawer').hidden=true;document.body.style.overflow='';if(lastFocus?.isConnected)lastFocus.focus();else document.querySelector('.cart-trigger').focus();}

document.addEventListener('click',event=>{
  const add=event.target.closest('[data-add-cart]');if(add){setCartQuantity(add.dataset.addCart,(state.cart.get(add.dataset.addCart)||0)+1);showToast('Добавлено в кошик');return;}
  const change=event.target.closest('[data-cart-change]');if(change){setCartQuantity(change.dataset.cartChange,(state.cart.get(change.dataset.cartChange)||0)+Number(change.dataset.delta));return;}
  const remove=event.target.closest('[data-cart-remove]');if(remove){setCartQuantity(remove.dataset.cartRemove,0);return;}
  const fullInfo=event.target.closest('[data-full-info]');if(fullInfo){openInfo(fullInfo.dataset.fullInfo);return;}
  const info=event.target.closest('[data-info]');if(info){openInfo(info.dataset.info);return;}
  const favorite=event.target.closest('[data-favorite]');if(favorite){toggleFavorite(favorite.dataset.favorite);return;}
  const open=event.target.closest('[data-open]');if(open){if(open.dataset.open==='favorites'||open.dataset.open==='cart')openDrawer(open.dataset.open==='cart'?'cartDrawer':'favoritesDrawer');else $('aboutDialog').showModal();return;}
  const view=event.target.closest('[data-view]');if(view){state.deals=view.dataset.view==='offers';state.pp=view.dataset.view==='pp';render();return;}
  const store=event.target.closest('[data-store]');if(store){state.store=state.store===store.dataset.store?'all':store.dataset.store;render();return;}
  const category=event.target.closest('[data-category]');if(category){Object.assign(state,{category:category.dataset.category,noSugar:false,lactoseFree:false,sugarMax:'',fatMax:''});render();$('categoryRail').scrollTop=0;closeFilters();return;}
});
const cardPreviewMedia=matchMedia('(hover:hover) and (min-width:961px)');
for(const type of ['pointerover','focusin'])document.addEventListener(type,event=>{const element=event.target.closest('.product-card.has-specs');if(element&&cardPreviewMedia.matches)loadCardSpecs(element);});
const mobileFilters=matchMedia('(max-width:960px)');
function syncFilterPanel() {$('categoryRail').inert=mobileFilters.matches&&!document.body.classList.contains('filters-open');}
function closeFilters() {const wasOpen=document.body.classList.contains('filters-open');document.body.classList.remove('filters-open');$('filterOverlay').hidden=true;$('openFilters').setAttribute('aria-expanded','false');$('categoryRail').removeAttribute('role');$('categoryRail').removeAttribute('aria-modal');syncFilterPanel();if(wasOpen&&mobileFilters.matches)$('openFilters').focus();}
$('openFilters').addEventListener('click',()=>{document.body.classList.add('filters-open');$('filterOverlay').hidden=false;$('openFilters').setAttribute('aria-expanded','true');$('categoryRail').setAttribute('role','dialog');$('categoryRail').setAttribute('aria-modal','true');syncFilterPanel();$('closeFilters').focus();});
mobileFilters.addEventListener('change',()=>{if(!mobileFilters.matches)closeFilters();syncFilterPanel();});
syncFilterPanel();
$('closeFilters').addEventListener('click',closeFilters);
$('filterOverlay').addEventListener('click',closeFilters);
$('searchInput').addEventListener('input',event=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.query=event.target.value.trim();render();},160);});
$('noSugar').addEventListener('change',event=>{state.noSugar=event.target.checked;render();});
$('lactoseFree').addEventListener('change',event=>{state.lactoseFree=event.target.checked;render();});
$('sugarMax').addEventListener('change',event=>{state.sugarMax=event.target.value;render();});
$('fatMax').addEventListener('change',event=>{state.fatMax=event.target.value;render();});
$('clearCharacters').addEventListener('click',()=>{Object.assign(state,{noSugar:false,lactoseFree:false,sugarMax:'',fatMax:''});render();});
$('sortSelect').addEventListener('change',event=>{state.sort=event.target.value;render();});
$('loadMore').addEventListener('click',showMore);
function resetCatalogFilters() {Object.assign(state,{store:'all',category:'',query:'',noSugar:false,lactoseFree:false,sugarMax:'',fatMax:'',sort:'default'});$('searchInput').value='';$('sortSelect').value='default';render();}
$('resetFilters').addEventListener('click',resetCatalogFilters);
$('resetSidebar').addEventListener('click',resetCatalogFilters);
$('closeFavorites').addEventListener('click',closeDrawer);
$('closeCart').addEventListener('click',closeDrawer);
$('drawerOverlay').addEventListener('click',closeDrawer);
$('closeAbout').addEventListener('click',()=>$('aboutDialog').close());
$('aboutDialog').addEventListener('click',event=>{if(event.target===$('aboutDialog'))$('aboutDialog').close();});
$('closeInfo').addEventListener('click',()=>$('infoDialog').close());
$('infoDialog').addEventListener('click',event=>{if(event.target===$('infoDialog'))$('infoDialog').close();});
$('infoDialog').addEventListener('close',()=>infoFocus?.focus());
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'){if(!$('favoritesDrawer').hidden||!$('cartDrawer').hidden)closeDrawer();if(document.body.classList.contains('filters-open'))closeFilters();}
  if(event.key==='Tab') {
    const panel=document.body.classList.contains('filters-open')?$('categoryRail'):!$('favoritesDrawer').hidden?$('favoritesDrawer'):!$('cartDrawer').hidden?$('cartDrawer'):null;
    if(!panel)return;
    const controls=[...panel.querySelectorAll('button,input,select,summary,a[href]')].filter(control=>control.getClientRects().length&&!control.closest('[hidden]'));
    if(event.shiftKey&&document.activeElement===controls[0]){event.preventDefault();controls.at(-1)?.focus();}
    else if(!event.shiftKey&&document.activeElement===controls.at(-1)){event.preventDefault();controls[0]?.focus();}
  }
});

(async()=>{
  try {
    const responses=await Promise.all(['meta.json','products.json','lidl-products.json','eurospin-products.json','coop-images.json','product-attributes.json','product-info-index.json'].map(path=>fetch(path)));
    if(responses.some(response=>!response.ok))throw new Error('Catalog data unavailable');
    const [metadata,products,lidlProducts,eurospinProducts,coopImages,attributes,index]=await Promise.all(responses.map(response=>response.json()));
    meta=metadata;infoIndex=index;state.products=[...products,...lidlProducts,...eurospinProducts];
    const infoKeys=new Set(index.keys);
    state.products.forEach(product=>{if(product.store==='Coop'&&coopImages[product.key]){product.image=coopImages[product.key];product.direct_image=true;}product._attributes=attributes[product.key];product._hasInfo=infoKeys.has(product.key);cleanCatalogName(product);product._ppRank=ppRank(product);product._search=normalize([product.name_it,product.name_ru,product.store].join(' '));map.set(product.key,product);});
    try{const saved=JSON.parse(localStorage.getItem('spesa-viterbo-favorites-v1')||'[]');state.favorites=new Set(Array.isArray(saved)?saved.filter(key=>map.has(key)):[]);}catch{}
    try{const saved=JSON.parse(localStorage.getItem('shopping-by-tuzin-cart-v1')||'[]');if(Array.isArray(saved))state.cart=new Map(saved.filter(entry=>Array.isArray(entry)&&map.has(entry[0])&&Number.isInteger(entry[1])&&entry[1]>0&&entry[1]<=999));}catch{}
    const params=new URLSearchParams(location.search);
    if(['Coop','Conad','Lidl','Eurospin'].includes(params.get('store')))state.store=params.get('store');
    if(meta.categories.some(category=>category.id===params.get('category')))state.category=params.get('category');
    if(['price-asc','price-desc','name'].includes(params.get('sort')))state.sort=params.get('sort');
    state.deals=params.get('offers')==='1';state.pp=!state.deals&&params.get('pp')==='1';
    if(!state.category)state.category=({soda:'drinks',yogurt:'dairy',milk:'dairy'})[params.get('kind')]||'';
    if(state.category) {
      state.noSugar=params.get('noSugar')==='1';state.lactoseFree=params.get('lactoseFree')==='1';
      if(['0.5','2','5','10'].includes(params.get('sugarMax')))state.sugarMax=params.get('sugarMax');
      if(['0.5','1.5','2','5'].includes(params.get('fatMax')))state.fatMax=params.get('fatMax');
    }
    state.query=params.get('q')||'';
    $('searchInput').value=state.query;$('sortSelect').value=state.sort;
    updateFavoriteCount();updateCartCount();render();
  } catch(error) {
    console.error(error);
    $('products').innerHTML='<p class="loading">Не удалось загрузить каталог. Обновите страницу.</p>';
    $('resultCount').textContent='Ошибка загрузки';
  }
})();
