"""Build persisted, searchable subcategories from product names and source paths."""

from collections import Counter
from pathlib import Path
from urllib.parse import unquote, urlparse
import json
import re
import unicodedata

ROOT = Path(__file__).resolve().parent
FILES = ("products.json", "lidl-products.json", "eurospin-products.json")

# Ordered specific-to-general; unmatched items remain in their original parent.
GROUPS = {
    "fruit": [
        ("prepared", "Фруктовые пюре и нарезка", r"mousse|purea|frullat|cubetti|macedonia|fette|shot|sciropp"),
        ("citrus", "Цитрусовые", r"aranc|mandarin|clementin|limon|pompelm|lime|agrum|mapo"),
        ("apples-pears", "Яблоки и груши", r"\bmel[aei]\b|\bper[ae]\b"),
        ("berries", "Ягоды", r"fragol|mirtill|lampon|mora\b|more\b|ribes|frutti di bosco"),
        ("bananas", "Бананы", r"banan|platano"),
        ("tropical", "Тропические фрукты", r"ananas|avocado|mango|kiwi|cocco|papaya|passion|zenzero|litchi"),
        ("stone-grapes", "Косточковые и виноград", r"pesche|pesca\b|nettar|albicocc|susin|prugn|cilieg|uva\b|fichi|cachi|kaki"),
        ("melons", "Арбузы и дыни", r"melon|anguria|cocomer"),
    ],
    "vegetables": [
        ("preserved", "Овощные консервы и оливки", r"olive|capperi|lattina|sott.?olio|sottaceto|salamoia|sgocc|vaso vetro|passat|pelati|polpa"),
        ("prepared", "Овощные смеси и нарезка", r"contorn|minestr|zupp|cotto|cotti|cotte|cotta|vapore|julienne|trifolat|grigliat|cubetti|vellutat"),
        ("salads", "Салаты и зелень", r"insalat|lattug|iceberg|rucol|valerian|songin|spinac|bieta|bietol|cicori|radicch|scarol|sedano|prezzem|basilic|rosmarin|salvia|menta|erbe|ravanell"),
        ("tomatoes", "Помидоры и огурцы", r"pomodor|cetriol"),
        ("roots", "Корнеплоды, лук и чеснок", r"patat|carot|cipoll|aglio|porr|rap[ae]\b|barbabiet|finocch"),
        ("cabbages", "Капуста и брокколи", r"cavol|broccol|cappucc|verza|cime di rapa"),
        ("peppers", "Перец, кабачки и баклажаны", r"peperon|zucchin|melanzan|zucca|asparag|carciof"),
        ("mushrooms", "Грибы", r"fungh|champignon|porcin|tartufo"),
        ("legumes", "Бобовые", r"fagiol|pisell|ceci|lenticch|fave|soia|legum"),
    ],
    "nuts": [
        ("mixes", "Смеси орехов и сухофруктов", r"mix|misto|misti|cocktail|trail"),
        ("seeds", "Семечки и семена", r"semi|seme|chia\b|lino\b|girasole|zucca"),
        ("dried", "Сухофрукты", r"essicc|disidrat|datter|uvett|sultan|prugn|albicocc|fichi|zenzero|cocco|mango|papaya|banan"),
        ("nuts", "Орехи", r"noc[ei]|noci|nocciol|arachid|mandorl|pistacch|anacard|pinol|pecan|macadam|castagn"),
    ],
    "meat": [
        ("prepared", "Маринованное мясо и полуфабрикаты", r"panat|cotolet|involt|spiedin|arrosticin|cordon|ripien|marinat|pollo al|arrosto"),
        ("minced", "Фарш, бургеры и колбаски", r"macinat|hamburger|burger|polpett|salsicc|tartare"),
        ("poultry", "Птица и кролик", r"pollo|tacchin|conigl|gallin|anatra|faraon|quagl"),
        ("pork", "Свинина", r"suino|suina|maiale|porchett|pancett|lonza|lombo"),
        ("beef", "Говядина и телятина", r"bovino|vitell|manzo|scotton|fiorentin|chianin"),
        ("lamb", "Баранина", r"agnell|pecor|ovino|capretto"),
    ],
    "deli": [
        ("ham", "Ветчина и прошутто", r"prosciutt|cotto|crudo|culat|culott|culatt|fiocco"),
        ("salami", "Салями и сырокопчёные колбасы", r"salam|salum|soppress|finocchion|ventricin|nduja"),
        ("sausages", "Сосиски и варёные колбасы", r"wurstel|wuerstel|mortadell|cotechin|zampone|salsicc"),
        ("cured", "Бекон, шпек и брезаола", r"bresaol|speck|bacon|pancett|guancial|coppa|lardo|petto|fesa"),
        ("seafood", "Рыбные закуски", r"salmon|surimi|acciug|alici|tonno|gamber"),
    ],
    "fish": [
        ("canned", "Рыбные консервы", r"tonno|sgombr|sardin|alici|acciugh|lattina|vaso|sgocc|in olio"),
        ("smoked", "Копчёная и солёная рыба", r"affumic|marinat|sotto sale|salmone|baccala"),
        ("seafood", "Морепродукты", r"gamber|mazzancoll|cozz|vongol|polp[oi]|calamar|seppi|moscard|totan|scamp|surimi|mollusch"),
        ("prepared", "Рыбные полуфабрикаты", r"panat|bastonc|burger|insalat|sughi|sugo|gratin"),
        ("fresh", "Свежая рыба и филе", r"filett|tranc|orata|branzino|spigola|trot|merluzz|platess|pesce|ricciol|rombo|nasell|gallinel"),
    ],
    "dairy": [
        ("snacks", "Молочные перекусы", r"\bmerenda\b|\bsnack\b"),
        ("yogurt", "Йогурты, кефир и скир", r"yogurt|yoghurt|kefir|skyr|activia|actimel|hipro|fermentat|probiotic|yomino"),
        ("plant", "Растительные напитки", r"bevanda|soia|soya|avena|riso|mandorla|alpro|vegetal"),
        ("eggs", "Яйца", r"\buov[aoe]\b|albume"),
        ("cream", "Масло, сливки и сметана", r"burro|panna|margarin|besciam|creme fraiche"),
        ("desserts", "Молочные десерты", r"dessert|budin|crema|cioccolat|danette|danao|monte\b|nesquik|risolatte|muu muu"),
        ("milk", "Молоко", r"latte|latticello"),
    ],
    "cheese": [
        ("grated", "Тёртые сыры и ломтики", r"grattugiat|fett[aei]|sottilett|fuso|julienne|scagli|slices"),
        ("fresh", "Свежие и творожные сыры", r"mozzarell|burrat|ricott|stracciatell|fiordilatte|mascarpon|philadelphia|spalmabil|fiocchi|robiol|stracchin|crescenz|quark|feta"),
        ("soft", "Мягкие сыры и сыры с плесенью", r"brie|camembert|gorgonzol|taleggio|blu\b|caprin"),
        ("hard", "Твёрдые и полутвёрдые сыры", r"grana|parmigian|pecorin|emmental|gouda|edam|provol|scamorz|caciott|caciocavall|asiago|fontina|galbanin|montasio"),
    ],
    "bread": [
        ("snacks", "Крекеры, хлебцы и снеки", r"cracker|grissin|tarall|gallette|crostin|bruschett|patatin|chips|salatin|snack|schiacciatin|sfoglie"),
        ("flatbread", "Питы, лепёшки и основы для пиццы", r"piad|pita\b|tortill|pizza|focacc|base"),
        ("pastry", "Выпечка", r"croissant|cornett|brioche|sfogliat|trecc|pain au|fagott|dolce|cannol|tort[ae]|muffin|donut|crostata"),
        ("toast", "Тостовый хлеб и булочки", r"toast|tramezzin|pan carre|pancarre|panbauletto|bauletto|hamburger|hot dog|panino|panini"),
        ("bread", "Хлеб", r"pane|filon|pagnot|panific|ciabatt|baguette|rosett|fresell"),
    ],
    "sweets": [
        ("spreads", "Шоколадные и ореховые пасты", r"nutella|spalmabil|crema|creme|pasta di nocciole"),
        ("candy", "Конфеты, леденцы и жвачка", r"caramell|gomm|chewing|vivident|mentos|golia|tic tac|marshmallow|gel[ée]e|chupa|ricola|haribo|confetti"),
        ("seasonal", "Сезонные сладости", r"panetton|pandor|colomba|torrone|avvent|pasqua|uovo|uova|ovett|calza|halloween"),
        ("chocolate", "Шоколад и шоколадные конфеты", r"cioccolat|ciocobloc|cremini|pralin|giandui|baci\b|kinder|ferrero|tavolet|choco|lindt|rittere?|ritter|duplo|wafer"),
    ],
    "breakfast": [
        ("jams", "Джемы, мёд и пасты", r"confettur|marmellat|miele|spalmabil|sciroppo"),
        ("cereals", "Хлопья, мюсли и каши", r"cereal|muesli|musli|granola|fiocchi|porridge|corn flakes|avena|choco pops"),
        ("bars", "Батончики", r"barrett|barrette|protein bar"),
        ("cakes", "Кексы и сладкая выпечка", r"merend|plumcake|buondi|muffin|fagott|croissant|cornett|brioche|tort[ae]|crostata|roll|girell|pan di|pain|crostatin"),
        ("cookies", "Печенье, вафли и сухари", r"biscott|frollin|savoiard|wafer|cookie|fette biscott|krumir|macin|gallett|pavesin|canestrell|novell|tarall"),
    ],
    "pasta": [
        ("fresh", "Свежая паста и ньокки", r"gnocch|tortell|raviol|cappellett|girasol|pansott|agnolott|ripien|pasta fresca|sfoglia"),
        ("rice", "Рис и ризотто", r"riso\b|risott|basmati|carnaroli|arborio|parboil"),
        ("grains", "Крупы и кускус", r"cous|cuscus|quinoa|farro|orzo|bulgur|avena|grano saraceno|miglio|grani|lenticch|ceci|muesli"),
        ("noodles", "Лапша", r"noodle|ramen|udon|soba|vermicelli di"),
        ("pasta", "Сухая паста", r"pasta|spaghett|linguin|penne|rigat|fusill|farfall|paccher|dital|stellin|anell|bucat|tagliat|maccher|lasagn|capell|fettucc|orecch|mezze|rummo|barilla|de cecco|trofi|conchigli|ruot|tubett|tempestin"),
    ],
    "pantry": [
        ("fish", "Рыбные консервы", r"tonno|sgombr|sardin|acciugh|alici|salmone|vongol"),
        ("oils", "Масло и уксус", r"olio|aceto|acetelli|balsamic"),
        ("spices", "Специи, соль и бульоны", r"spezi|aromat|basilic|origano|rosmarin|prezzem|curcuma|cannell|zenzero|pepe|peperonc|noce moscata|paprika|chiodi|zafferan|dado|dadi|brodo|sale\b|sal[ei]\b|sesamo|aneto|curry"),
        ("sauces", "Соусы, песто и томаты", r"sals|sugh|sugo|pesto|passat|pomodor|pelat|polpa|maiones|ketchup|senap|mayo|concentrato|ragu"),
        ("canned", "Овощные консервы и бобовые", r"ceci|fagiol|lenticch|pisell|mais|legum|olive|capper|carciof|funghi|giardinier|cetriol|peperon|melanzan|zucchin|verdure"),
        ("soups", "Супы и готовые блюда", r"zupp|minestr|vellutat|preparat|piatto|cucin|polenta|pure\b"),
        ("world", "Продукты кухонь мира", r"soia|soja|wasabi|sushi|taco|tortill|nacho|jalapen|guacamol|cocco|messican|oriental"),
    ],
    "baking": [
        ("flour", "Мука, крахмал и сухари", r"farin|amido|fecola|pangratt|semola|polenta|fiocchi"),
        ("sugar", "Сахар и подсластители", r"zuccher|dolcificant|stevia|fruttosio|eritrit"),
        ("yeast", "Дрожжи и разрыхлители", r"lievit|bicarbonat|cremor"),
        ("dough", "Тесто и готовые смеси", r"sfoglia|brisee|bris[ée]|frolla|impasto|preparat|budin|torta|crema|creme|risolatte"),
        ("decor", "Украшения и ароматизаторы", r"arom|vanill|decor|glassa|topping|top\b|candit|cacao|gelatin|colla di pesce|codett|cioccolat"),
    ],
    "ready": [
        ("vegetarian", "Растительные блюда", r"vegetal|veggie|tofu|seitan|tempeh|soia|soja|kioene"),
        ("sandwiches", "Пицца и сэндвичи", r"pizza|tramezz|sandwich|panin|piad|focacc|tortill"),
        ("soups", "Супы и овощные блюда", r"zupp|vellutat|minestr|insalat|friariell|verdure|contorn"),
        ("meals", "Готовые блюда", r"pasta|lasagn|riso|risott|polenta|pollo|carne|chili|cotolet|polpett|parmigian|cous"),
    ],
    "frozen": [
        ("icecream", "Мороженое и десерты", r"gelat|sorbett|cono|coni|magnum|cornett|ghiacciol|viennetta|dessert|torta|profiterol"),
        ("fish", "Рыба и морепродукты", r"pesce|filett|merluzz|platess|salmone|gamber|mazzancoll|cozz|vongol|calamar|totan|surimi|bastonc|nasell|findus|polp[oi]|seppi"),
        ("vegetables", "Овощи, фрукты и ягоды", r"verdur|minestr|pisell|fagiol|spinac|broccol|cavol|carot|zucchin|melanzan|funghi|porcin|friariell|asparag|frutt|fragol|mirtill|lampon|zucca|carciof|contorn"),
        ("pizza", "Пицца, выпечка и закуски", r"pizza|focacc|suppli|crocchett|patat|panzerott|sfoglia|cornett|croissant|pane|salatin|arancin"),
        ("meat", "Мясо и птица", r"carne|pollo|tacchin|hamburger|burger|cotolet|nugget|polpett|suino"),
        ("meals", "Блюда и паста", r"pasta|lasagn|gnocch|riso|risott|cannellon|tortell|raviol|piatto|paella"),
    ],
    "drinks": [
        ("soda", "Газированные напитки", r"cola|pepsi|fanta|sprite|gassat|aranciat|limonat|tonic|tonica|chinotto|gassosa|gazzosa|cedrat|schweppes|ginger beer|ginger ale|crodino"),
        ("energy", "Энергетики и спортивные напитки", r"energy|energetic|red bull|monster|powerade|gatorade|isotonic|sport"),
        ("iced-tea", "Холодный чай", r"\bte\b|\btea\b|estathe|fuzetea|fuzete|san benedetto the|\bthe\b"),
        ("water", "Вода", r"acqua|minerale"),
        ("plant", "Растительные напитки", r"soia|soya|avena|mandorla|bevanda di riso|bevanda.*cocco"),
        ("syrups", "Сиропы и концентраты", r"sciropp|concentrat|orzat"),
        ("juice", "Соки, нектары и смузи", r"succo|nettare|spremut|frullat|smoothie|frutta|skipper|santal|zuegg|yoga|ace\b|arancia|ananas|mela|pesca|mango|melograno"),
    ],
    "coffee": [
        ("capsules", "Капсулы и чалды", r"capsul|ciald|nespresso|dolce gusto|a modo mio|nescafe espresso"),
        ("instant", "Растворимый кофе и цикорий", r"solubil|istantan|nescafe|orzo|ginseng|cicoria|cappuccino"),
        ("herbal", "Травяные чаи", r"tisan|infus|camomill|finocch|zenzero|rooibos|relax"),
        ("tea", "Чай", r"\bte\b|\btea\b|\bthe\b|twinings|lipton|destein|matcha"),
        ("cocoa", "Какао и горячий шоколад", r"cacao|cioccolat|nesquik|ovomalt|ciobar"),
        ("coffee", "Молотый и зерновой кофе", r"caffe|espresso|arabica|robusta|moka|gran[io]|lavazza|illy|trombetta|bellarom|miscela"),
    ],
    "alcohol": [
        ("beer", "Пиво и сидр", r"birra|beer|radler|lager|pils|\bipa\b|cider|sidro"),
        ("sparkling", "Игристые вина", r"prosecc|spumant|champagn|franciacort|brut|cuvee|cava\b|lambrusc|moscato|frizzant"),
        ("spirits", "Крепкий алкоголь и ликёры", r"whisk|vodka|gin\b|rum\b|rhum|tequila|grappa|brandy|cognac|amaro|liquor|limonc|sambuc|baileys|fernet|jager|jagermeister|stock 84"),
        ("aperitif", "Аперитивы и коктейли", r"aperitiv|spritz|aperol|campari|martini|vermouth|cocktail|negroni|sangria|punch"),
        ("wine", "Вино", r"vino|vin[io]\b|docg?|ig[pt]|chardonnay|merlot|cabernet|sauvignon|pinot|chianti|barolo|montepulciano|trebb|rosso|bianco|rosato|rose|sangiovese|primitivo|negroamaro"),
    ],
    "special": [
        ("supplements", "Добавки и витамины", r"integrator|vitamin|compresse|capsule|garcinia|magnesio|probiotic|melatonina|fermenti"),
        ("gluten-free", "Без глютена", r"senza glutine|schar|celiac|gluten"),
        ("protein", "Протеиновые продукты", r"protein|enervit|barrett|sport|isotonic"),
        ("plant", "Растительные продукты", r"vegan|vegetal|tofu|seitan|tempeh|burger|soia|soya"),
    ],
    "kids": [
        ("diapers", "Подгузники и пелёнки", r"pannolin|pannoloni|mutandin|pampers|traversin|cambio"),
        ("formula", "Молочные смеси", r"latte|formula|nativa|mellin [123]|aptamil|nidina"),
        ("food", "Детское питание", r"omogeneizz|purea|frutta|pappa|biscott|pastin|yogurt|merenda|crema.*(?:riso|mais|cereali)|liofilizz"),
        ("care", "Уход за ребёнком", r"salviet|detergent|bagno|shampoo|crema|olio|talco|cotone"),
        ("accessories", "Детские аксессуары и игрушки", r"biberon|tettar|succhiett|ciuccio|bicchiere|sacco|gioco|bambol|principess|disney|frozen|lego"),
    ],
    "pets": [
        ("accessories", "Уход и аксессуары", r"lettier|ciotol|guinzag|sacchett|collar|tiragraff|shampoo|igien|traversin|gioch"),
        ("cat", "Для кошек", r"gatt|felin|cat\b|whiskas|sheba|gourmet|felix|miglior gatto|catisfact|kitekat"),
        ("dog", "Для собак", r"can[ei]\b|cani|dog\b|cesar|pedigree|frolic|dentastix|esigo|radames|orlando"),
        ("small", "Для птиц, рыб и грызунов", r"uccell|canarin|pappagall|pesci|roditor|cricet|conigli|tartarug"),
    ],
    "care": [
        ("oral", "Уход за полостью рта", r"dentifric|spazzolin|dentale|collutor|dentier|floss|interdent|oral b|sensodyn|colgat|listerin"),
        ("hair", "Волосы и окрашивание", r"shampoo|capelli|balsamo|colorazion|tinta|olia|excellence|lacca|pantene|fructis|elvive|pettin|spazzol"),
        ("shaving", "Бритьё и депиляция", r"rasoi|barba|lamett|depil|gillette|venus|veet"),
        ("hygiene", "Женская гигиена и бумажные изделия", r"assorbent|tampon|salvaslip|intim|lines\b|nuvenia|carta igienica|fazzolett|incontinen"),
        ("face", "Лицо, косметика и солнцезащита", r"viso|faccia|strucc|micellar|make up|mascara|rossett|kajal|trucco|occhi|ombrett|fondotint|smalto|sun|solare|abbronz|labbr|lip\b|anti.?rughe"),
        ("health", "Здоровье и аксессуары", r"cerott|disinfett|cotone|bastoncin|termometr|profilatt|preservativ|siring|mascherin|gel mani|acqua ossigenata|lenti|medicazion"),
        ("body", "Тело, душ и дезодоранты", r"bagn|doccia|sapone|saponett|deodor|corpo|mani|piedi|crema|olio|profum|talco|neutro|dove\b"),
    ],
    "cleaning": [
        ("laundry", "Стирка и уход за одеждой", r"lavatrice|bucato|ammorb|amm conc|smacch|detersivo.*(?:polvere|liquido)|perlana|lenor|ace gentile|omino|lana|spazzola adesiva|vanish"),
        ("dishes", "Мытьё посуды", r"piatti|lavastovigl|brillantant|finish|fairy|svelto|svitol"),
        ("insects", "Средства от насекомых", r"insett|zanzar|vape|raid|formich|scarafagg|elettroemanator"),
        ("supplies", "Губки, пакеты и инвентарь", r"spugn|pann[oi]|guant|sacch|mopp|scopa|secchi|swiffer|piumin|stuzzicadent|spazzol|mocio"),
        ("surfaces", "Уборка и дезинфекция", r"detergent|sgrass|paviment|candegg|disinfett|wc|vetri|calcare|idraulic|spray|lysoform|amuchina|cif\b|alcool|alcol|sgorg|lavand|forno"),
    ],
    "home": [
        ("paper", "Бумажные и одноразовые изделия", r"asciugatutto|tovagliol|carta|piatti|bicchier|posate|cucchiai|forchett|cannucce|stecch|stuzzicadent"),
        ("storage", "Хранение и упаковка", r"sacchett|sacchi|pellicol|alluminio|contenitor|barattol|conserv|sottovuoto|portapranzo"),
        ("textiles", "Текстиль и интерьер", r"lenzuol|tessil|asciugaman|cuscino|copert|trapunt|tenda|tappet|piumin|divano|poltrona|letto|materass|candela|profumator|append"),
        ("electronics", "Электроника и свет", r"batteri|pile\b|lampad|\bled\b|telecamer|usb|cavo|caric|auricol|presa|prolung|smart|tv\b|radio|speaker"),
        ("appliances", "Бытовая техника", r"friggitr|forno|frullat|robot|tost|bollitor|aspirapolver|ferro da stiro|asciugacapelli|phon|macchina|caffe|piastra|bilancia|mixer"),
        ("kitchen", "Посуда и кухонные принадлежности", r"pentol|padell|tegam|moka|tazz|piatt|bicchier|bottigli|stampo|tegli|coltell|cucina|mestol|taglier|scol|grattug|sprem|thermos|apriscatol"),
    ],
    "clothes": [
        ("socks", "Носки и колготки", r"calz[aei]|calzin|salvapied|pariscarp|collant"),
        ("underwear", "Бельё", r"intim|slip|boxer|reggiseno|canottier"),
        ("shoes", "Обувь", r"scarp|ciabatt|sandal|stival"),
        ("apparel", "Одежда", r"magli|t.?shirt|pantalon|felpa|giacc|pigiama|vestit|camicia|bermuda"),
    ],
    "garden": [
        ("plants", "Растения, грунт и удобрения", r"piant|terricc|concim|vas[oi]|sottovas|orchide|sapone molle|corroborant|fior"),
        ("tools", "Садовый инвентарь", r"guant|forbic|tubo|annaff|rastrell|vanga|levaragn|telescopic|utensil"),
        ("outdoor", "Отдых и барбекю", r"barbecue|carbon|accendifuoco|telo|campegg|sdraio|ombrell|piscin|griglia"),
    ],
    "other": [
        ("stationery", "Канцтовары", r"cartoler|penna|penne|matit|quadern|ricambi|portalistin|colla|evidenziator|tratto|righell|gomma|canceller|fogli|raccoglit|blocco|\ba4\b"),
        ("tools", "Инструменты и авто", r"auto|moto|bici|levigatr|trapano|avvitat|scala|chiav|utensil|coprised|cacciavit|martell|pinza|compressor"),
        ("electronics", "Электроника и свет", r"\bled\b|telecamer|lampad|batteri|cavo|caric|presa|elettric"),
        ("leisure", "Игры, спорт и сезонные товары", r"gioco|piscin|pallon|natale|nataliz|albero|decor|halloween|carneval|sport|tenda|campegg|lego|puzzle"),
    ],
}


def normalized(text):
    return "".join(c for c in unicodedata.normalize("NFKD", text.lower()) if not unicodedata.combining(c)).replace("-", " ").replace("'", " ")


def classify(product):
    parent = product["category"]
    name = normalized(product["name_it"])
    # A few broad source sections mix unrelated products. Require a clear product prefix.
    if product["store"] in {"Eurospin", "Lidl"} and parent not in {"frozen", "special", "kids", "pets"}:
        for corrected, pattern in (
            ("alcohol", r"^(?:vino|birra|prosecco|spumante|whisky|vodka|grappa)\b"),
            ("sweets", r"^(?:cioccolatin[io]|cioccolato|caramelle|torrone|ovetti)\b"),
            ("breakfast", r"^(?:biscotti|frollini|confettura|marmellata|muesli|granola)\b"),
            ("cleaning", r"^(?:detersivo|detergente|candeggina|sgrassatore|idraulico gel|ammorbidente)\b"),
            ("home", r"^(?:tovaglioli|asciugatutto|carta igienica)\b"),
        ):
            if re.search(pattern, name):
                parent = corrected
                break
    # Name takes precedence over broad URL ancestor terms such as latte/uova/burro.
    rules = GROUPS.get(parent, [])
    for child, _, pattern in rules:
        if re.search(pattern, name):
            return parent, f"{parent}-{child}"
    # A broad ancestor like yogurt-e-dessert must not turn every dessert into yogurt.
    segments = urlparse(product.get("url", "")).path.strip("/").split("/")
    path = normalized(unquote(segments[-2])) if len(segments) > 2 else ""
    for child, _, pattern in rules:
        if re.search(pattern, path):
            return parent, f"{parent}-{child}"
    return parent, f"{parent}-other"


def write(path, data):
    text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    if not path.exists() or path.read_text(encoding="utf-8") != text:
        temp = path.with_suffix(".tmp")
        temp.write_text(text, encoding="utf-8")
        temp.replace(path)


def build():
    catalogs = {name: json.loads((ROOT / name).read_text(encoding="utf-8")) for name in FILES}
    products = [p for catalog in catalogs.values() for p in catalog]
    counts = Counter()
    for product in products:
        product["category"], product["subcategory"] = classify(product)
        counts[product["subcategory"]] += 1
    metadata = json.loads((ROOT / "meta.json").read_text(encoding="utf-8"))
    taxonomy = []
    for category in metadata["categories"]:
        parent = category["id"]
        children = [{"id": f"{parent}-{key}", "name": label} for key, label, _ in GROUPS[parent]]
        if parent == "dairy":
            order = ["milk", "yogurt", "plant", "cream", "eggs", "desserts", "snacks"]
            children.sort(key=lambda child: order.index(child["id"].removeprefix("dairy-")))
        children.append({"id": f"{parent}-other", "name": "Другие товары раздела"})
        taxonomy.append({"id": parent, "children": children})
        category["count"] = sum(p["category"] == parent for p in products)
    metadata["count"] = len(products)
    metadata["translation"] = "Названия переведены на русский; оригинал сохранён для поиска."
    for store in {p["store"] for p in products}:
        items = [p for p in products if p["store"] == store]
        metadata.setdefault("shops", {}).setdefault(store.lower(), {}).update(name=store, count=len(items), prices=sum(bool(p.get("price")) for p in items))
    for name, catalog in catalogs.items():
        write(ROOT / name, catalog)
    write(ROOT / "catalog-taxonomy.json", taxonomy)
    write(ROOT / "meta.json", metadata)
    print("Categorized:", len(products), "products;", sum(bool(counts[c["id"]]) for t in taxonomy for c in t["children"]), "subcategories")
    for parent in GROUPS:
        print(parent, sum(n for key, n in counts.items() if key.startswith(parent + "-")), "fallback:", counts[parent + "-other"])


if __name__ == "__main__":
    build()
