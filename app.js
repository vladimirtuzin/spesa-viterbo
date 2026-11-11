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
const state = {store:'all',category:'',query:'',priced:true,deals:false,pp:false,kind:'',noSugar:false,lactoseFree:false,sugarMax:'',fatMax:'',sort:'default',limit:40,products:[],filtered:[],favorites:new Set()};
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
const kinds = {soda:{name:'Газировка',category:'drinks'},yogurt:{name:'Йогурты',category:'dairy'},milk:{name:'Молоко',category:'dairy'}};
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

function matches(product, ignoreCategory=false, ignoreStore=false, ignoreKind=false, ignoreView=false, ignoreAttributes=false) {
  const attributes=product._attributes||{};
  return (ignoreStore || state.store==='all' || product.store===state.store) &&
    (ignoreCategory || !state.category || product.category===state.category) &&
    (!state.priced || !!product.price) &&
    (ignoreView || !state.deals || isDeal(product)) &&
    (ignoreView || !state.pp || product._ppRank!=null) &&
    (ignoreKind || !state.kind || attributes.kind===state.kind) &&
    (ignoreAttributes || !state.noSugar || attributes.sugar_free) &&
    (ignoreAttributes || !state.lactoseFree || attributes.lactose_free) &&
    (ignoreAttributes || !state.sugarMax || attributes.sugar_g!=null && attributes.sugar_g<=Number(state.sugarMax)) &&
    (ignoreAttributes || !state.fatMax || attributes.fat_g!=null && attributes.fat_g<=Number(state.fatMax)) &&
    (!state.query || product._search.includes(normalize(state.query)));
}

function renderCategories() {
  const eligible = state.products.filter(product => matches(product,true,false,true,false,true));
  const counts = new Map();
  for (const product of eligible) counts.set(product.category,(counts.get(product.category)||0)+1);
  const categories = [{id:'',name:state.deals?'Все скидки':state.pp?'Все ПП-товары':'Все товары',count:eligible.length},...meta.categories.map(category=>({...category,count:counts.get(category.id)||0}))]
    .filter(category=>!category.id || category.count || category.id===state.category);
  if (state.kind) {
    const selected=categories.findIndex(category=>category.id===state.category);
    if (selected>1) categories.splice(1,0,categories.splice(selected,1)[0]);
  }
  $('categories').innerHTML = categories.map(category=>{
    const children=Object.entries(kinds).filter(([,kind])=>kind.category===category.id).map(([id,kind])=>{
      const count=eligible.filter(product=>product.category===category.id&&product._attributes?.kind===id).length;
      return count||state.kind===id?`<button class="subcategory ${state.kind===id?'active':''}" type="button" data-kind="${id}" aria-pressed="${state.kind===id}"><span>${kind.name}</span><small>${number(count)}</small></button>`:'';
    }).join('');
    return `<button class="category ${state.category===category.id&&!state.kind?'active':''}" type="button" data-category="${category.id}" aria-pressed="${state.category===category.id&&!state.kind}"><span class="category-icon" aria-hidden="true">${category.id?categoryIcons[category.id]||'◇':'▦'}</span><span>${escapeHtml(category.name)}</span><small>${number(category.count)}</small></button>${children}`;
  }).join('');
}

function syncUrl() {
  const params = new URLSearchParams();
  if (state.store!=='all') params.set('store',state.store);
  if (state.category) params.set('category',state.category);
  if (state.query) params.set('q',state.query);
  if (state.deals) params.set('offers','1');
  if (state.pp) params.set('pp','1');
  if (state.kind) params.set('kind',state.kind);
  if (state.noSugar) params.set('noSugar','1');
  if (state.lactoseFree) params.set('lactoseFree','1');
  if (state.sugarMax) params.set('sugarMax',state.sugarMax);
  if (state.fatMax) params.set('fatMax',state.fatMax);
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
function renderCharacteristics() {
  $('characterFilters').hidden=!state.kind;
  $('noSugarWrap').hidden=state.kind!=='soda';
  $('lactoseFreeWrap').hidden=state.kind!=='milk';
  $('sugarMaxWrap').hidden=state.kind==='milk';
  $('fatMaxWrap').hidden=state.kind==='soda';
  $('sugarUnit').textContent=state.kind==='soda'?'Сахар / 100 мл':'Сахар / 100 г';
  $('fatUnit').textContent=state.kind==='milk'?'Жиры / 100 мл':'Жиры / 100 г';
  $('noSugar').checked=state.noSugar;
  $('lactoseFree').checked=state.lactoseFree;
  $('sugarMax').value=state.sugarMax;
  $('fatMax').value=state.fatMax;
  $('characterNote').hidden=!state.sugarMax&&!state.fatMax;
  $('openFilters').querySelector('span').textContent=state.kind?`Категории · ${kinds[state.kind].name}`:'Категории и фильтры';
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
  for(const product of state.products)if(matches(product,false,true))storeCounts.set(product.store,(storeCounts.get(product.store)||0)+1);
  $('allStoreCount').textContent=productCount([...storeCounts.values()].reduce((sum,count)=>sum+count,0));
  for(const store of ['Coop','Conad','Lidl','Eurospin'])$(''+store.toLowerCase()+'Count').textContent=productCount(storeCounts.get(store)||0);
  $('offerTotalCount').textContent=number(state.products.filter(product=>isDeal(product)&&matches(product,false,false,false,true)).length);
  $('ppTotalCount').textContent=number(state.products.filter(product=>product._ppRank!=null&&matches(product,false,false,false,true)).length);
  $('emptyState').hidden = !!state.filtered.length;
  $('emptyState').querySelector('h3').textContent = state.deals ? 'Скидок не найдено' : state.pp ? 'Подходящих товаров не найдено' : 'Пока ничего не нашлось';
  $('emptyState').querySelector('p').textContent = state.deals ? 'В этом разделе или магазине нет опубликованных предложений. Попробуйте другой фильтр.' : 'Попробуйте другое название или откройте все разделы.';
  const categoryName=meta.categories.find(category=>category.id===state.category)?.name;
  const title=(state.kind&&kinds[state.kind].name)||categoryName||'Все товары';
  $('categoryTitle').textContent = state.deals ? title==='Все товары'?'Скидки':`Скидки · ${title}` : state.pp ? title==='Все товары'?'ПП':`ПП · ${title}` : title;
  $('scopeLabel').textContent = state.store==='all'?'ВСЕ МАГАЗИНЫ':state.store.toUpperCase();
  $('scopeNote').textContent = state.deals ? 'Акции и цены по карте из открытых каталогов.' : scope[state.store];
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
  const view=event.target.closest('[data-view]');if(view){state.deals=view.dataset.view==='offers';state.pp=view.dataset.view==='pp';render();return;}
  const store=event.target.closest('[data-store]');if(store){state.store=state.store===store.dataset.store?'all':store.dataset.store;render();return;}
  const category=event.target.closest('[data-category]');if(category){Object.assign(state,{category:category.dataset.category,kind:'',noSugar:false,lactoseFree:false,sugarMax:'',fatMax:''});render();closeFilters();return;}
  const kind=event.target.closest('[data-kind]');if(kind){const selected=state.kind===kind.dataset.kind?'':kind.dataset.kind;Object.assign(state,{kind:selected,category:kinds[kind.dataset.kind].category,noSugar:false,lactoseFree:false,sugarMax:'',fatMax:''});render();$('categoryRail').scrollTop=0;if(selected)closeFilters();return;}
});
function closeFilters() {const wasOpen=document.body.classList.contains('filters-open');document.body.classList.remove('filters-open');$('filterOverlay').hidden=true;$('openFilters').setAttribute('aria-expanded','false');if(wasOpen)$('openFilters').focus();}
$('openFilters').addEventListener('click',()=>{document.body.classList.add('filters-open');$('filterOverlay').hidden=false;$('openFilters').setAttribute('aria-expanded','true');$('closeFilters').focus();});
$('closeFilters').addEventListener('click',closeFilters);
$('filterOverlay').addEventListener('click',closeFilters);
$('searchInput').addEventListener('input',event=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.query=event.target.value.trim();render();},160);});
$('onlyPriced').addEventListener('change',event=>{state.priced=event.target.checked;render();});
$('noSugar').addEventListener('change',event=>{state.noSugar=event.target.checked;render();});
$('lactoseFree').addEventListener('change',event=>{state.lactoseFree=event.target.checked;render();});
$('sugarMax').addEventListener('change',event=>{state.sugarMax=event.target.value;render();});
$('fatMax').addEventListener('change',event=>{state.fatMax=event.target.value;render();});
$('clearCharacters').addEventListener('click',()=>{Object.assign(state,{noSugar:false,lactoseFree:false,sugarMax:'',fatMax:''});render();});
$('sortSelect').addEventListener('change',event=>{state.sort=event.target.value;render();});
$('loadMore').addEventListener('click',showMore);
$('resetFilters').addEventListener('click',()=>{Object.assign(state,{store:'all',category:'',query:'',priced:true,deals:false,pp:false,kind:'',noSugar:false,lactoseFree:false,sugarMax:'',fatMax:'',sort:'default'});$('searchInput').value='';$('onlyPriced').checked=true;$('sortSelect').value='default';render();});
$('closeFavorites').addEventListener('click',closeFavorites);
$('drawerOverlay').addEventListener('click',closeFavorites);
$('closeAbout').addEventListener('click',()=>$('aboutDialog').close());
$('aboutDialog').addEventListener('click',event=>{if(event.target===$('aboutDialog'))$('aboutDialog').close();});
$('closeInfo').addEventListener('click',()=>$('infoDialog').close());
$('infoDialog').addEventListener('click',event=>{if(event.target===$('infoDialog'))$('infoDialog').close();});
$('infoDialog').addEventListener('close',()=>infoFocus?.focus());
document.addEventListener('keydown',event=>{if(event.key==='Escape'){if(!$('favoritesDrawer').hidden)closeFavorites();if(document.body.classList.contains('filters-open'))closeFilters();}});

(async()=>{
  try {
    const responses=await Promise.all(['meta.json','products.json','lidl-products.json','eurospin-products.json','coop-images.json','product-attributes.json'].map(path=>fetch(path)));
    if(responses.some(response=>!response.ok))throw new Error('Catalog data unavailable');
    const [metadata,products,lidlProducts,eurospinProducts,coopImages,attributes]=await Promise.all(responses.map(response=>response.json()));
    meta=metadata;state.products=[...products,...lidlProducts,...eurospinProducts];
    state.products.forEach(product=>{if(product.store==='Coop'&&coopImages[product.key]){product.image=coopImages[product.key];product.direct_image=true;}product._attributes=attributes[product.key];cleanCatalogName(product);product._ppRank=ppRank(product);product._search=normalize([product.name_it,product.name_ru,product.store].join(' '));map.set(product.key,product);});
    try{const saved=JSON.parse(localStorage.getItem('spesa-viterbo-favorites-v1')||'[]');state.favorites=new Set(Array.isArray(saved)?saved.filter(key=>map.has(key)):[]);}catch{}
    const params=new URLSearchParams(location.search);
    if(['Coop','Conad','Lidl','Eurospin'].includes(params.get('store')))state.store=params.get('store');
    if(meta.categories.some(category=>category.id===params.get('category')))state.category=params.get('category');
    if(['price-asc','price-desc','name'].includes(params.get('sort')))state.sort=params.get('sort');
    state.deals=params.get('offers')==='1';state.pp=!state.deals&&params.get('pp')==='1';
    if(kinds[params.get('kind')]){state.kind=params.get('kind');state.category=kinds[state.kind].category;}
    if(state.kind==='soda')state.noSugar=params.get('noSugar')==='1';
    if(state.kind==='milk')state.lactoseFree=params.get('lactoseFree')==='1';
    if(['0.5','2','5','10'].includes(params.get('sugarMax'))&&['soda','yogurt'].includes(state.kind))state.sugarMax=params.get('sugarMax');
    if(['0.5','1.5','2','5'].includes(params.get('fatMax'))&&['yogurt','milk'].includes(state.kind))state.fatMax=params.get('fatMax');
    state.query=params.get('q')||'';state.priced=params.get('allPrices')!=='1';
    $('searchInput').value=state.query;$('onlyPriced').checked=state.priced;$('sortSelect').value=state.sort;
    $('totalCount').textContent=productCount(state.products.length);
    updateFavoriteCount();render();
  } catch(error) {
    console.error(error);
    $('products').innerHTML='<p class="loading">Не удалось загрузить каталог. Обновите страницу.</p>';
    $('resultCount').textContent='Ошибка загрузки';
  }
})();
