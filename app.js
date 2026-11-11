'use strict';
const $ = id => document.getElementById(id);
async function checkEntry(){
  const gate=$('entryGate'),content=$('siteContent');
  let allowed=false;
  try{allowed=localStorage.getItem('shopping-by-tuzin-entry-v1')==='no';}catch{}
  try{allowed ||= document.cookie.split(';').some(cookie=>cookie.trim()==='tuzin_entry=no');}catch{}
  const enter=()=>{gate.hidden=true;content.hidden=false;};
  if(allowed){enter();return true;}
  $('entryTitle').focus({preventScroll:true});
  return new Promise(resolve=>{
    $('entryForm').addEventListener('submit',event=>{
      event.preventDefault();
      if(event.submitter?.value==='no'){
        try{localStorage.setItem('shopping-by-tuzin-entry-v1','no');}catch{}
        try{document.cookie=`tuzin_entry=no; Max-Age=31536000; Path=/; SameSite=Lax${location.protocol==='https:'?'; Secure':''}`;}catch{}
        enter();$('categoryTitle').setAttribute('tabindex','-1');$('categoryTitle').focus({preventScroll:true});resolve(true);
      }else if(event.submitter?.value==='yes'){
        $('entryQuestion').hidden=true;$('entryDenied').hidden=false;gate.classList.add('denied');$('entryDenied').focus({preventScroll:true});resolve(false);
        window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
      }
    });
  });
}
const euro = value => new Intl.NumberFormat('ru-RU',{style:'currency',currency:'EUR'}).format(value);
const number = value => new Intl.NumberFormat('ru-RU').format(value);
const productCount = value => `${number(value)} ${({one:'товар',few:'товара',many:'товаров'})[new Intl.PluralRules('ru').select(value)]}`;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const normalize = value => String(value??'').normalize('NFKD').replace(/\p{Diacritic}/gu,'').toLowerCase();
const hasPrice = product => Number.isFinite(product.price)&&product.price>0;
const state = {store:'all',category:'',subcategory:'',query:'',deals:false,pp:false,noSugar:false,lactoseFree:false,sugarMax:'',fatMax:'',sort:'default',limit:40,products:[],filtered:[],cart:new Map()};
const map=new Map(),infoCache=new Map(),infoShards=new Map(),expandedCategories=new Set();
let meta,infoIndex,taxonomy,searchTimer,lastFocus,lastFocusKey;
const storeIcons={Coop:'coop.ico',Conad:'conad.png',Lidl:'lidl.png',Eurospin:'eurospin.png'};
const infoIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v6M12 7v.5"/></svg>';
const cartIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 3h3l2.1 12h12.4l2-9H6"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/></svg>';
const plusIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const checkIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';
const chevron='<svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>';
document.addEventListener('error',event=>{if(event.target.tagName==='IMG'){const photo=event.target.closest('.photo-window');if(photo)photo.outerHTML=imageMarkup({image:''});}},true);
function imageMarkup(product,small=false){
  if(!product.image)return '<span class="placeholder-art"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="m4 17 5-5 4 4 3-3 5 5"/><circle cx="15" cy="8" r="2"/></svg><small>Нет изображения</small></span>';
  const alt=small?'':escapeHtml(product.name_ru||product.name_it);
  if(product.direct_image)return `<div class="photo-window direct"><img src="${escapeHtml(product.image)}" alt="${alt}" loading="lazy" decoding="async"></div>`;
  return `<div class="photo-window"><img src="${escapeHtml(product.image)}" alt="${alt}" loading="lazy" decoding="async" style="width:${product.sprite_columns*100}%;height:${product.sprite_rows*100}%;left:-${product.sprite_x*100}%;top:-${product.sprite_y*100}%"></div>`;
}
const lineTotal=(product,quantity)=>hasPrice(product)?Math.round(product.price*100)*quantity/100:0;
const memberPrice=product=>hasPrice(product)&&!product.future&&!product.expired&&Number.isFinite(product.member_price)&&product.member_price>0&&product.member_price<product.price?product.member_price:null;
function measure(value){
  const units={kg:'кг',g:'г',ml:'мл',cl:'сл',l:'л',lt:'л',pz:'шт.'};
  return String(value||'').replace(/€\s*([\d.,]+)/g,'$1 €').replace(/\b(?:confezione|confezioni)\b/gi,'упаковка').replace(/\bbottiglia\b/gi,'бутылка').replace(/\blattina\b/gi,'банка').replace(/\b(?:rete|busta)\b/gi,'пакет').replace(/\b(?:circa|ca)\b\.?/gi,'≈').replace(/\ba peso\b/gi,'на вес').replace(/(\d)\s*(kg|ml|cl|g|l)\b/gi,(_,n,u)=>`${n} ${units[u.toLowerCase()]}`).replace(/\b(kg|ml|cl|lt|g|l|pz)\b/gi,u=>units[u.toLowerCase()]).replace(/(\d)\.(?=\d)/g,'$1,').replace(/\s*[x×]\s*(?=\d)/g,' × ').replace(/\s+e$/i,' ℮');
}
function card(product){
  const key=escapeHtml(product.key),name=escapeHtml(product.name_ru||product.name_it),loyalty=memberPrice(product);
  const note=loyalty!=null?`<span class="member-offer"><strong>${euro(loyalty)}</strong> по карте ${escapeHtml(product.store)}${product.note?.includes(' · ')?`<small>${escapeHtml(product.note.split(' · ').slice(1).join(' · '))}</small>`:''}</span>`:isDeal(product)&&product.note?`<span class="offer-note">${escapeHtml(product.note)}</span>`:'';
  return `<article class="product-card" data-key="${key}" tabindex="-1" aria-label="${name}">
    <div class="card-heading"><span class="card-store store-${product.store.toLowerCase()}"><img src="assets/store-icons/${storeIcons[product.store]}" alt=""><span>${escapeHtml(product.store)}</span></span><button class="info-button" type="button" data-info="${key}" aria-label="Состав и пищевая ценность: ${name}" aria-expanded="false" aria-controls="spec-${key}" title="Состав и пищевая ценность">${infoIcon}</button></div>
    <div class="card-visual"><div class="product-media">${imageMarkup(product)}</div></div>
    <div class="product-content"><h3 class="product-name" lang="ru" title="${name}">${name}</h3><p class="pack">${escapeHtml(measure(product.pack))}</p></div>
    <div class="purchase-row"><span class="price ${hasPrice(product)?loyalty==null&&isDeal(product)?'sale-price':'':'unpriced'}">${hasPrice(product)?euro(product.price):'Нет цены'}</span><div class="cart-card-control" data-cart-control="${key}">${cartControl(product)}</div></div>
    <div class="price-meta">${product.unit_price?`<span class="unit-price">${escapeHtml(measure(product.unit_price))}</span>`:''}${note}</div>
    <section class="card-details" id="spec-${key}" aria-label="Состав и пищевая ценность" hidden><div class="spec-scroll" tabindex="0" data-spec-content></div></section>
  </article>`;
}
function cartControl(product){
  const key=escapeHtml(product.key),quantity=state.cart.get(product.key)||0,name=escapeHtml(product.name_ru||product.name_it);
  if(!hasPrice(product))return `<button type="button" class="add-cart" disabled aria-label="Нельзя добавить: цена не опубликована" title="Цена не опубликована">${plusIcon}</button>`;
  return quantity?`<button type="button" class="in-cart" data-open="cart" aria-label="${name}: в корзине ${quantity}. Изменить количество" title="В корзине ${quantity}. Изменить количество">${quantity<100?checkIcon:''}<span>${quantity<100?quantity:'99+'}</span></button>`:`<button type="button" class="add-cart" data-add-cart="${key}" aria-label="Добавить в корзину: ${name}" title="Добавить в корзину">${plusIcon}</button>`;
}
function updateCartCount(){$('cartCount').textContent=number([...state.cart.values()].reduce((sum,quantity)=>sum+quantity,0));}
function setCartQuantity(key,quantity){
  if(!map.has(key)||quantity>0&&!hasPrice(map.get(key)))return false;
  const active=document.activeElement,wasInDrawer=active?.closest('#cartDrawer');
  const focusDelta=active?.dataset.cartChange?active.dataset.delta:active?.dataset.addCart?'1':null,removed=active?.hasAttribute('data-cart-remove');
  quantity=Math.max(0,Math.min(999,Math.trunc(quantity)));
  if(quantity)state.cart.set(key,quantity);else state.cart.delete(key);
  try{localStorage.setItem('shopping-by-tuzin-cart-v1',JSON.stringify([...state.cart]));}catch{showToast('Браузер не сохранил корзину');}
  updateCartCount();
  document.querySelectorAll('[data-cart-control]').forEach(element=>{if(element.dataset.cartControl===key)element.innerHTML=cartControl(map.get(key));});
  if(!$('cartDrawer').hidden)renderCart();
  if(focusDelta!==null){
    const scope=wasInDrawer?$('cartDrawer'):$('products');
    const next=[...scope.querySelectorAll('[data-cart-change]')].find(button=>button.dataset.cartChange===key&&button.dataset.delta===focusDelta);
    const add=[...scope.querySelectorAll('[data-add-cart]')].find(button=>button.dataset.addCart===key);
    const cardButton=wasInDrawer?null:[...$('products').querySelectorAll('[data-cart-control]')].find(e=>e.dataset.cartControl===key)?.querySelector('button');
    (next||add||cardButton||$('closeCart')).focus({preventScroll:true});
  }else if(removed)($('cartItems').querySelector('[data-cart-remove]')||$('closeCart')).focus({preventScroll:true});
  return true;
}
function renderCart(){
  const entries=[...state.cart].map(([key,quantity])=>({product:map.get(key),quantity})).filter(entry=>entry.product),stores=[...new Set(entries.map(entry=>entry.product.store))];
  $('cartItemCount').textContent=entries.length?productCount(entries.length):'Соберите свой список покупок';
  $('cartItems').innerHTML=entries.length?stores.map(store=>{
    const items=entries.filter(entry=>entry.product.store===store);
    return `<section class="cart-group"><h3><span><img src="assets/store-icons/${storeIcons[store]}" alt="">${escapeHtml(store)}</span><b>${euro(items.reduce((sum,{product,quantity})=>sum+Math.round((hasPrice(product)?product.price:0)*100)*quantity,0)/100)}</b></h3>${items.map(({product,quantity})=>`<article class="cart-item"><div class="cart-thumb">${imageMarkup(product,true)}</div><div class="cart-item-body"><strong>${escapeHtml(product.name_ru||product.name_it)}</strong><small>${[measure(product.pack),hasPrice(product)?euro(product.price):''].filter(Boolean).map(escapeHtml).join(' · ')}</small><div class="cart-item-bottom"><div class="quantity-stepper"><button type="button" data-cart-change="${escapeHtml(product.key)}" data-delta="-1" aria-label="Уменьшить количество">−</button><output>${quantity}</output><button type="button" data-cart-change="${escapeHtml(product.key)}" data-delta="1" aria-label="Увеличить количество" ${hasPrice(product)?'':'disabled'}>+</button></div><b>${hasPrice(product)?euro(lineTotal(product,quantity)):'Нет цены'}</b></div></div><button class="remove-cart" type="button" data-cart-remove="${escapeHtml(product.key)}" aria-label="Удалить ${escapeHtml(product.name_ru||product.name_it)} из корзины">×</button></article>`).join('')}</section>`;
  }).join(''):`<div class="cart-empty"><span>${cartIcon}</span><h3>Начнём со списка?</h3><p>Нажмите плюс рядом с ценой товара — он появится здесь.</p><button type="button" class="return-catalog" data-close-cart>В каталог ${chevron}</button></div>`;
  $('cartFooter').hidden=!entries.length;
  $('cartTotal').textContent=euro(entries.reduce((sum,{product,quantity})=>sum+Math.round((hasPrice(product)?product.price:0)*100)*quantity,0)/100);
  $('cartTotalLabel').textContent=entries.some(({product})=>!hasPrice(product))?'По опубликованным ценам':'Итого';
  $('cartPriceNote').hidden=!entries.some(({product})=>memberPrice(product)!=null);
}
function isDeal(product){return hasPrice(product)&&!product.future&&!product.expired&&(memberPrice(product)!=null||/^-\d+%/.test(product.note||'')||product.note==='Акционная цена');}
function ppRank(product){
  const a=product._attributes||{};
  if(product.category==='fruit'||product.category==='vegetables'){
    const label=`${product.name_it} ${product.pack||''}`;
    if(/sciropp|candit|disidrat|essiccat|conserv|confettur|marmellat|succo|salsa|sott.?olio|in olio|grigliat|fritt|chips|zuccherat|passata|vellutata|omogeneizzat|surgelat|zuppa|spremuta|sottaceto|agrodolce|acetelli|giardiniera|salamoia|vaso vetro|\bv\.\s*v\.|snack|gusto|precott|decorticat/i.test(label))return null;
    const fresh=/\bcat\.?\s*[i1]\b|percorso qualità|fresc[oaie]|a peso|1 pz|\b(?:rete|mazzo|pezzo|vassoio|vaschetta)\b/i.test(label)||product.store==='Lidl'&&/\b(?:confezione|busta)\s+[\d.,]+\s*kg\b/i.test(product.pack||'')&&/^(?:cuori di iceberg|insalata|carote|valeriana|lattughino|lattuga|rucola|spinaci|pomodori|broccoli|cavolo|cavolfiore|cetrioli|peperoni|zucchine|melanzane|fagiolini|funghi|fragole|mirtilli|lamponi|uva|mele|pere|arance|mandarini|limoni|pesche|albicocche|banane|kiwi|avocado)\b/i.test(product.name_it);
    return fresh?product.category==='vegetables'?0:20:null;
  }
  if(a.kind==='yogurt'&&a.sugar_g!=null&&a.sugar_g<=5&&a.fat_g!=null&&a.fat_g<=5)return 100+a.sugar_g*10+a.fat_g;
  if(a.kind==='milk'&&a.fat_g!=null&&a.fat_g<=1.5)return 200+a.fat_g*10;
  if(a.kind==='soda'&&(a.sugar_free||a.sugar_g!=null&&a.sugar_g<=0.5))return 300+(a.sugar_g||0);
  return null;
}
function matches(product,{ignoreCategory=false,ignoreStore=false,ignoreView=false,ignoreAttributes=false}={}){
  const a=product._attributes||{};
  return (ignoreStore||state.store==='all'||product.store===state.store)&&(ignoreCategory||(!state.category||product.category===state.category)&&(!state.subcategory||product.subcategory===state.subcategory))&&(ignoreView||!state.deals||isDeal(product))&&(ignoreView||!state.pp||product._ppRank!=null)&&(ignoreAttributes||!state.noSugar||a.sugar_free)&&(ignoreAttributes||!state.lactoseFree||a.lactose_free)&&(ignoreAttributes||!state.sugarMax||a.sugar_g!=null&&a.sugar_g<=Number(state.sugarMax))&&(ignoreAttributes||!state.fatMax||a.fat_g!=null&&a.fat_g<=Number(state.fatMax))&&(!state.query||product._search.includes(normalize(state.query)));
}
function renderCategories(){
  const focused=document.activeElement?.closest('#categories button');
  const focusCategory=focused?.dataset.category,focusChild=focused?.dataset.subcategory;
  const eligible=state.products.filter(product=>matches(product,{ignoreCategory:true,ignoreAttributes:true})),counts=new Map(),childCounts=new Map();
  for(const product of eligible){counts.set(product.category,(counts.get(product.category)||0)+1);childCounts.set(product.subcategory,(childCounts.get(product.subcategory)||0)+1);}
  const allLabel=state.deals?'Все скидки':state.pp?'Вся подборка ПП':'Все товары';
  let html=`<button class="category category-all ${!state.category?'active':''}" type="button" data-category="" aria-pressed="${!state.category}"><span>${allLabel}</span><small>${number(eligible.length)}</small></button>`;
  html+=meta.categories.map(category=>{
    const expanded=expandedCategories.has(category.id),selected=state.category===category.id,count=counts.get(category.id)||0,children=taxonomy.find(group=>group.id===category.id)?.children||[];
    return `<div class="category-group"><button class="category ${selected?'selected-parent':''} ${selected&&!state.subcategory?'active':''} ${count?'':'no-results'}" type="button" data-category="${category.id}" aria-expanded="${expanded}" aria-controls="children-${category.id}" ${!count&&!selected?'disabled':''} aria-pressed="${selected&&!state.subcategory}"><span>${escapeHtml(category.name)}</span><small>${number(count)}</small>${chevron}</button><div class="category-children" id="children-${category.id}" ${expanded?'':'hidden'}>${children.filter(child=>childCounts.get(child.id)||state.subcategory===child.id).map(child=>`<button class="category child-category ${state.subcategory===child.id?'active':''}" type="button" data-subcategory="${child.id}" data-parent="${category.id}" aria-pressed="${state.subcategory===child.id}"><span>${escapeHtml(child.name)}</span><small>${number(childCounts.get(child.id)||0)}</small></button>`).join('')||'<p class="category-empty">Нет товаров по выбранным фильтрам</p>'}</div></div>`;
  }).join('');$('categories').innerHTML=html;
  if(focused)[...$('categories').querySelectorAll('button')].find(button=>focusChild?button.dataset.subcategory===focusChild:button.dataset.category===focusCategory)?.focus({preventScroll:true});
}
function syncUrl(){
  const params=new URLSearchParams();if(state.store!=='all')params.set('store',state.store);
  for(const [key,value] of Object.entries({category:state.category,subcategory:state.subcategory,q:state.query,offers:state.deals?'1':'',pp:state.pp?'1':'',noSugar:state.noSugar?'1':'',lactoseFree:state.lactoseFree?'1':'',sugarMax:state.sugarMax,fatMax:state.fatMax,sort:state.sort==='default'?'':state.sort}))if(value)params.set(key,value);
  history.replaceState(null,'',location.pathname+(params.size?'?'+params:''));
}
function updatePagination(){
  const total=state.filtered.length,shown=Math.min(state.limit,total);
  $('shownCount').textContent=total?`Показано ${number(shown)} из ${number(total)} · ${Math.ceil(shown/40)} из ${Math.ceil(total/40)} страниц`:'';
  $('pageProgress').style.width=total?`${shown/total*100}%`:'0%';$('loadMore').hidden=shown>=total;
  if(shown<total)$('loadMore').innerHTML=`Показать ещё ${productCount(Math.min(40,total-shown))} <span>Страница ${Math.floor(shown/40)+1} ↓</span>`;
}
function showMore(event){const start=state.limit;state.limit+=40;$('products').insertAdjacentHTML('beforeend',state.filtered.slice(start,state.limit).map(card).join(''));updatePagination();if(event?.detail===0){const first=$('products').children[start];(first?.querySelector('button:not(:disabled)')||first)?.focus({preventScroll:true});}}
function renderCharacteristics(){
  const eligible=state.products.filter(product=>matches(product,{ignoreAttributes:true}));
  const sugar=eligible.some(p=>p._attributes?.sugar_g!=null)||!!state.sugarMax,fat=eligible.some(p=>p._attributes?.fat_g!=null)||!!state.fatMax,noSugar=eligible.some(p=>p._attributes?.sugar_free)||state.noSugar,lactose=eligible.some(p=>p._attributes?.lactose_free)||state.lactoseFree;
  $('characterFilters').hidden=!state.category||!sugar&&!fat&&!noSugar&&!lactose;
  $('noSugarWrap').hidden=!noSugar;$('lactoseFreeWrap').hidden=!lactose;$('sugarMaxWrap').hidden=!sugar;$('fatMaxWrap').hidden=!fat;
  const basis=state.category==='drinks'||state.subcategory==='dairy-milk'||state.subcategory==='dairy-plant'?'100 мл':state.category==='dairy'&&!state.subcategory?'100 г/мл':'100 г';
  $('sugarUnit').textContent=`Сахар / ${basis}`;$('fatUnit').textContent=`Жиры / ${basis}`;
  $('noSugar').checked=state.noSugar;$('lactoseFree').checked=state.lactoseFree;$('sugarMax').value=state.sugarMax;$('fatMax').value=state.fatMax;$('characterNote').hidden=!state.sugarMax&&!state.fatMax;
  const chosen=[state.noSugar,state.lactoseFree,!!state.sugarMax,!!state.fatMax].filter(Boolean).length;
  $('filterCounter').hidden=!chosen;$('filterCounter').textContent=chosen;
  $('characterSelection').textContent=$('categoryTitle').textContent+(chosen?` · выбрано: ${chosen}`:'');$('resetSidebar').hidden=state.store==='all'&&!state.category&&!state.query&&!chosen&&state.sort==='default';
}
function render(){
  if(!meta)return;state.limit=40;state.filtered=state.products.filter(product=>matches(product));
  const rank=new Map(meta.categories.map((category,index)=>[category.id,index]));
  state.filtered.sort((a,b)=>{
    if(state.sort==='price-asc'||state.sort==='price-desc'){if(!hasPrice(a))return hasPrice(b)?1:0;if(!hasPrice(b))return -1;return(a.price-b.price)*(state.sort==='price-desc'?-1:1);}
    if(state.sort==='name')return(a.name_ru||a.name_it).localeCompare(b.name_ru||b.name_it,'ru');
    if(state.pp)return a._ppRank-b._ppRank||a.name_it.localeCompare(b.name_it,'it');
    return(rank.get(a.category)??99)-(rank.get(b.category)??99)||Number(hasPrice(b))-Number(hasPrice(a))||a.name_it.localeCompare(b.name_it,'it');
  });
  if(state.pp&&state.sort==='default'){
    const groups=[[],[],[],[],[]];for(const product of state.filtered)groups[product._ppRank===0?0:product._ppRank===20?1:Math.floor(product._ppRank/100)+1].push(product);
    state.filtered=Array.from({length:Math.max(...groups.map(group=>group.length))},(_,i)=>groups.map(group=>group[i]).filter(Boolean)).flat();
  }
  $('products').innerHTML=state.filtered.slice(0,state.limit).map(card).join('');
  const storeCounts=new Map();for(const product of state.products)if(matches(product,{ignoreStore:true}))storeCounts.set(product.store,(storeCounts.get(product.store)||0)+1);
  $('allStoreCount').textContent=number([...storeCounts.values()].reduce((sum,count)=>sum+count,0));for(const store of ['Coop','Conad','Lidl','Eurospin'])$(store.toLowerCase()+'Count').textContent=number(storeCounts.get(store)||0);
  $('offerTotalCount').textContent=number(state.products.filter(p=>isDeal(p)&&matches(p,{ignoreView:true})).length);$('ppTotalCount').textContent=number(state.products.filter(p=>p._ppRank!=null&&matches(p,{ignoreView:true})).length);
  $('emptyState').hidden=!!state.filtered.length;$('emptyState').querySelector('h3').textContent=state.deals?'Скидок не найдено':state.pp?'Подходящих товаров не найдено':'Пока ничего не нашлось';
  const child=taxonomy.flatMap(group=>group.children).find(c=>c.id===state.subcategory),title=child?.name||meta.categories.find(c=>c.id===state.category)?.name;
  $('categoryTitle').textContent=title||(state.deals?'Скидки / Offerte':state.pp?'Правильное питание':'Все товары');$('resultCount').textContent=productCount(state.filtered.length);
  $('parentBreadcrumb').hidden=!state.subcategory;$('parentBreadcrumb').textContent=meta.categories.find(c=>c.id===state.category)?.name||'';$('sortSelect').options[0].textContent=state.pp?'По подборке':'По разделам';
  updatePagination();renderCharacteristics();
  $('clearSearch').hidden=!state.query;$('applyFilters').textContent=`Показать ${productCount(state.filtered.length)}`;
  const chosenFilters=[['noSugar',state.noSugar,'Без сахара'],['lactoseFree',state.lactoseFree,'Без лактозы'],['sugarMax',state.sugarMax,`Сахар до ${state.sugarMax.replace('.',',')} г`],['fatMax',state.fatMax,`Жиры до ${state.fatMax.replace('.',',')} г`]].filter(([,value])=>value);
  $('activeFilters').hidden=!chosenFilters.length;$('activeFilters').innerHTML=chosenFilters.map(([key,,label])=>`<button type="button" data-clear-filter="${key}" aria-label="Убрать фильтр: ${escapeHtml(label)}">${escapeHtml(label)} <span aria-hidden="true">×</span></button>`).join('');
  document.querySelectorAll('[data-view]').forEach(button=>{const active=button.dataset.view===(state.deals?'offers':state.pp?'pp':'all');button.classList.toggle('active',active);button.setAttribute('aria-pressed',active);});
  document.querySelectorAll('.store-tab').forEach(button=>{const active=button.dataset.store===state.store;button.classList.toggle('active',active);button.setAttribute('aria-pressed',active);button.disabled=!active&&button.dataset.store!=='all'&&!(storeCounts.get(button.dataset.store)||0);});renderCategories();syncUrl();
  const heading=document.querySelector('.catalog-main');if(heading.getBoundingClientRect().top<90)heading.scrollIntoView({block:'start',behavior:'instant'});
}
function showToast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>$('toast').hidden=true,2400);}
async function loadProductInfo(key){
  if(infoCache.has(key))return infoCache.get(key);
  if(map.get(key)?._hasInfo){
    const shard=(Number(key.match(/\d+$/)[0])%64).toString(16).padStart(2,'0');
    try{
      if(!infoShards.has(shard))infoShards.set(shard,fetch(`data/product-info/${shard}.json?v=${infoIndex.version}`).then(response=>{if(!response.ok)throw new Error('Saved product info unavailable');return response.json();}).catch(error=>{infoShards.delete(shard);throw error;}));
      const entry=(await infoShards.get(shard))[key];
      if(entry?.info){infoCache.set(key,entry.info);return entry.info;}
    }catch{} // A missing snapshot must not prevent the server from loading the label.
  }
  const response=await fetch(`api/info?key=${encodeURIComponent(key)}`);
  if(!response.ok)throw new Error('Product info unavailable');
  const info=await response.json();infoCache.set(key,info);return info;
}
const nutritionLabel=value=>({'energia':'Энергия','grassi':'Жиры','di cui':'Из них','di cui:':'Из них','carboidrati':'Углеводы','proteine':'Белки','fibre':'Клетчатка','sale':'Соль','zuccheri':'Сахар','di cui zuccheri':'Из них сахар','di cui: zuccheri':'Из них сахар','di cui acidi grassi saturi':'Насыщенные жиры','di cui: acidi grassi saturi':'Насыщенные жиры','- acidi grassi saturi':'Насыщенные жиры','acidi grassi saturi':'Насыщенные жиры'})[String(value).toLowerCase().trim()]||value;
function nutritionBasis(value){
  const text=String(value??'').trim(),amount=text.match(/\b100\s*(g|ml)\b/i);
  return amount?`На 100 ${amount[1].toLowerCase()==='g'?'г':'мл'}`:measure(text.replace(/^per\s+porzione\b/i,'На порцию'))||'Значение';
}
async function loadCardSpecs(element){
  if(element.dataset.specsLoaded)return;
  const content=element.querySelector('[data-spec-content]');
  content.innerHTML='<p class="spec-status" role="status">Загружаем состав…</p>';element.dataset.specsLoaded='loading';
  try{
    const info=await loadProductInfo(element.dataset.key),blocks=[];
    if(info.ingredients||info.allergens)blocks.push(`<section><h4>Состав</h4>${info.ingredients?`<p lang="it">${escapeHtml(info.ingredients).replace(/\n/g,'<br>')}</p>`:''}${info.allergens?`<p class="ingredients-allergens" lang="it"><strong lang="ru">Аллергены:</strong> ${escapeHtml(info.allergens).replace(/\n/g,'<br>')}</p>`:''}</section>`);
    if(info.nutrition?.rows?.length){
      const table=info.nutrition;
      const headers=table.headers.map((value,index)=>`<th scope="col">${escapeHtml(index?value:value||'Показатель')}</th>`).join('');
      const rows=table.rows.filter(row=>row.slice(1).some(value=>String(value??'').trim())).map(row=>`<tr>${row.map((value,index)=>index?`<td data-label="${escapeHtml(nutritionBasis(table.headers[index]))}"${String(value??'').trim()?'':' class="nutrition-empty"'}>${escapeHtml(value)}</td>`:`<th scope="row">${escapeHtml(nutritionLabel(value))}</th>`).join('')}</tr>`).join('');
      blocks.push(`<section><h4>Пищевая ценность</h4><table class="nutrition-table"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table></section>`);
    }
    content.innerHTML=blocks.length?blocks.join(''):`<p class="spec-status">${info.status==='unsupported'?'В каталоге Lidl нет состава и таблицы питания.':'Магазин не вернул состав и пищевую ценность этого товара.'}</p>`;element.dataset.specsLoaded='ready';
  }catch{content.innerHTML='<p class="spec-status">Не удалось загрузить состав. <button type="button" class="text-button" data-retry-info>Повторить</button></p>';delete element.dataset.specsLoaded;}
}
function showSpecs(element,open){
  element.classList.toggle('spec-open',open);element.querySelector('.card-details').hidden=!open;
  const button=element.querySelector('[data-info]');button.setAttribute('aria-expanded',open);button.title=open?'Закрыть характеристики':'Состав и пищевая ценность';
  for(const part of element.querySelectorAll('.card-visual,.product-content,.purchase-row,.price-meta')){part.inert=open;part.setAttribute('aria-hidden',open);}
  if(open)loadCardSpecs(element);
}
function openDrawer(){lastFocus=document.activeElement;lastFocusKey=lastFocus?.closest('[data-cart-control]')?.dataset.cartControl;closeFilters(false);renderCart();$('drawerOverlay').hidden=false;$('cartDrawer').hidden=false;document.body.style.overflow='hidden';syncFilterPanel();$('closeCart').focus();}
function closeDrawer(){$('drawerOverlay').hidden=true;$('cartDrawer').hidden=true;document.body.style.overflow='';syncFilterPanel();if(lastFocus?.isConnected)lastFocus.focus();else ([...document.querySelectorAll('[data-cart-control]')].find(e=>e.dataset.cartControl===lastFocusKey)?.querySelector('button')||document.querySelector('.cart-trigger')).focus({preventScroll:true});}
function selectCategory(category,subcategory=''){Object.assign(state,{category,subcategory,noSugar:false,lactoseFree:false,sugarMax:'',fatMax:''});render();}
document.addEventListener('click',event=>{
  if(event.target.closest('[data-close-cart]')){closeDrawer();return;}
  const clear=event.target.closest('[data-clear-filter]');if(clear&&['noSugar','lactoseFree','sugarMax','fatMax'].includes(clear.dataset.clearFilter)){state[clear.dataset.clearFilter]=clear.dataset.clearFilter.endsWith('Max')?'':false;render();($('activeFilters').querySelector('button')||(mobileFilters.matches?$('openFilters'):$('characterFilters').querySelector('summary'))).focus({preventScroll:true});return;}
  const add=event.target.closest('[data-add-cart]');if(add){if(setCartQuantity(add.dataset.addCart,(state.cart.get(add.dataset.addCart)||0)+1))showToast('Добавлено в корзину');return;}
  const change=event.target.closest('[data-cart-change]');if(change){setCartQuantity(change.dataset.cartChange,(state.cart.get(change.dataset.cartChange)||0)+Number(change.dataset.delta));return;}
  const remove=event.target.closest('[data-cart-remove]');if(remove){setCartQuantity(remove.dataset.cartRemove,0);return;}
  const info=event.target.closest('[data-info]');if(info){const card=info.closest('.product-card');showSpecs(card,!card.classList.contains('spec-open'));return;}
  const retry=event.target.closest('[data-retry-info]');if(retry){loadCardSpecs(retry.closest('.product-card'));return;}
  const open=event.target.closest('[data-open]');if(open){if(open.dataset.open==='cart')openDrawer();else $('aboutDialog').showModal();return;}
  const view=event.target.closest('[data-view]');if(view){state.deals=view.dataset.view==='offers';state.pp=view.dataset.view==='pp';render();return;}
  const store=event.target.closest('[data-store]');if(store){state.store=state.store===store.dataset.store?'all':store.dataset.store;render();return;}
  const child=event.target.closest('[data-subcategory]');if(child){selectCategory(child.dataset.parent,child.dataset.subcategory);closeFilters();return;}
  const category=event.target.closest('[data-category]');if(category){const id=category.dataset.category;if(id){if(expandedCategories.has(id))expandedCategories.delete(id);else expandedCategories.add(id);}else expandedCategories.clear();selectCategory(id);}
});
new ResizeObserver(()=>document.documentElement.style.setProperty('--header-height',`${document.querySelector('.site-header').getBoundingClientRect().height}px`)).observe(document.querySelector('.site-header'));
const mobileFilters=matchMedia('(max-width:960px)');
function syncFilterPanel(){const filtering=document.body.classList.contains('filters-open'),cart=!$('cartDrawer').hidden;document.querySelector('.site-header').inert=filtering||cart;document.querySelector('.skip-link').inert=filtering||cart;document.querySelector('.page-shell').inert=cart;for(const selector of ['.catalog-main','.catalog-navigation','.site-footer'])document.querySelector(selector).inert=filtering;$('categoryRail').inert=mobileFilters.matches&&!filtering;}
function closeFilters(restoreFocus=true){const wasOpen=document.body.classList.contains('filters-open');document.body.classList.remove('filters-open');$('filterOverlay').hidden=true;$('openFilters').setAttribute('aria-expanded','false');$('categoryRail').removeAttribute('role');$('categoryRail').removeAttribute('aria-modal');syncFilterPanel();if(restoreFocus&&wasOpen&&mobileFilters.matches)$('openFilters').focus();}
$('openFilters').addEventListener('click',()=>{document.body.classList.add('filters-open');$('filterOverlay').hidden=false;$('openFilters').setAttribute('aria-expanded','true');$('categoryRail').setAttribute('role','dialog');$('categoryRail').setAttribute('aria-modal','true');syncFilterPanel();$('closeFilters').focus();});
mobileFilters.addEventListener('change',()=>{if(!mobileFilters.matches)closeFilters();syncFilterPanel();});syncFilterPanel();
$('applyFilters').addEventListener('click',()=>closeFilters());
$('clearSearch').addEventListener('click',()=>{clearTimeout(searchTimer);state.query='';$('searchInput').value='';render();$('searchInput').focus();});
$('closeFilters').addEventListener('click',closeFilters);$('filterOverlay').addEventListener('click',closeFilters);
$('searchInput').addEventListener('input',event=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.query=event.target.value.trim();render();},160);});
for(const id of ['noSugar','lactoseFree','sugarMax','fatMax'])$(id).addEventListener('change',event=>{state[id]=event.target.type==='checkbox'?event.target.checked:event.target.value;render();});
$('clearCharacters').addEventListener('click',()=>{Object.assign(state,{noSugar:false,lactoseFree:false,sugarMax:'',fatMax:''});render();});
$('sortSelect').addEventListener('change',event=>{state.sort=event.target.value;render();});$('loadMore').addEventListener('click',showMore);
function resetCatalogFilters(){Object.assign(state,{store:'all',category:'',subcategory:'',query:'',noSugar:false,lactoseFree:false,sugarMax:'',fatMax:'',sort:'default'});expandedCategories.clear();$('searchInput').value='';$('sortSelect').value='default';render();}
$('resetFilters').addEventListener('click',resetCatalogFilters);$('resetSidebar').addEventListener('click',resetCatalogFilters);$('parentBreadcrumb').addEventListener('click',()=>selectCategory(state.category));
$('closeCart').addEventListener('click',closeDrawer);$('drawerOverlay').addEventListener('click',closeDrawer);$('closeAbout').addEventListener('click',()=>$('aboutDialog').close());$('aboutDialog').addEventListener('click',event=>{if(event.target===$('aboutDialog'))$('aboutDialog').close();});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'){
    if(!$('cartDrawer').hidden)closeDrawer();if(document.body.classList.contains('filters-open'))closeFilters();
    document.querySelectorAll('.product-card.spec-open').forEach(card=>{if(card.querySelector('.card-details').contains(document.activeElement))card.querySelector('[data-info]').focus();showSpecs(card,false);});
  }
  if(event.key==='Tab'){
    const panel=document.body.classList.contains('filters-open')?$('categoryRail'):!$('cartDrawer').hidden?$('cartDrawer'):null;if(!panel)return;
    const controls=[...panel.querySelectorAll('button,input,select,summary,a[href]')].filter(c=>c.getClientRects().length&&!c.closest('[hidden]')&&!c.disabled);
    if(event.shiftKey&&document.activeElement===controls[0]){event.preventDefault();controls.at(-1)?.focus();}else if(!event.shiftKey&&document.activeElement===controls.at(-1)){event.preventDefault();controls[0]?.focus();}
  }
});
(async()=>{
  if(!await checkEntry())return;
  try{
    const responses=await Promise.all(['meta.json','products.json','lidl-products.json','eurospin-products.json','coop-images.json','product-attributes.json','product-info-index.json','catalog-taxonomy.json'].map(path=>fetch(path,{cache:'no-cache'})));
    if(responses.some(response=>!response.ok))throw new Error('Catalog data unavailable');
    const [metadata,products,lidlProducts,eurospinProducts,coopImages,attributes,index,categories]=await Promise.all(responses.map(response=>response.json()));
    meta=metadata;infoIndex=index;taxonomy=categories;state.products=[...products,...lidlProducts,...eurospinProducts];const infoKeys=new Set(index.keys);
    state.products.forEach(product=>{if(product.store==='Coop'&&coopImages[product.key]){product.image=coopImages[product.key];product.direct_image=true;}product._attributes=attributes[product.key];product._hasInfo=infoKeys.has(product.key);product._ppRank=ppRank(product);product._search=normalize([product.name_it,product.name_ru,product.store].join(' '));map.set(product.key,product);});
    try{const saved=JSON.parse(localStorage.getItem('shopping-by-tuzin-cart-v1')||'[]');if(Array.isArray(saved))state.cart=new Map(saved.filter(entry=>Array.isArray(entry)&&map.has(entry[0])&&Number.isInteger(entry[1])&&entry[1]>0&&entry[1]<=999));}catch{}
    const params=new URLSearchParams(location.search);
    if(['Coop','Conad','Lidl','Eurospin'].includes(params.get('store')))state.store=params.get('store');if(meta.categories.some(c=>c.id===params.get('category')))state.category=params.get('category');
    if(taxonomy.find(c=>c.id===state.category)?.children.some(c=>c.id===params.get('subcategory')))state.subcategory=params.get('subcategory');if(['price-asc','price-desc','name'].includes(params.get('sort')))state.sort=params.get('sort');
    state.deals=params.get('offers')==='1';state.pp=!state.deals&&params.get('pp')==='1';
    if(state.category){expandedCategories.add(state.category);state.noSugar=params.get('noSugar')==='1';state.lactoseFree=params.get('lactoseFree')==='1';if(['0.5','2','5','10'].includes(params.get('sugarMax')))state.sugarMax=params.get('sugarMax');if(['0.5','1.5','2','5'].includes(params.get('fatMax')))state.fatMax=params.get('fatMax');}
    state.query=params.get('q')||'';$('searchInput').value=state.query;$('sortSelect').value=state.sort;updateCartCount();render();
  }catch(error){console.error(error);$('products').innerHTML='<p class="loading">Не удалось загрузить каталог. Обновите страницу.</p>';$('resultCount').textContent='Ошибка загрузки';}
})();
