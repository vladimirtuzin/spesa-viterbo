from pathlib import Path
import json
import build_taxonomy as taxonomy

cases=[
 ('Latte senza lattosio','dairy','dairy-milk'),
 ('Yogurt bianco soia senza zucchero','dairy','dairy-yogurt'),
 ('Bevanda di mandorla','dairy','dairy-plant'),
 ('Cola zero','drinks','drinks-soda'),
 ('Acqua minerale naturale','drinks','drinks-water'),
 ('Tè al limone zero','drinks','drinks-iced-tea'),
 ('Cioccolatini fondenti','pantry','sweets-chocolate'),
 ('Vino bianco DOC','drinks','alcohol-wine'),
 ('Tovaglioli bianchi','vegetables','home-paper'),
 ('Caffè macinato','coffee','coffee-coffee'),
 ('Capsule caffè compatibili Nespresso','coffee','coffee-capsules'),
 ('Snack parmareggio abc della merenda','dairy','dairy-snacks'),
]
for name,parent,expected in cases:
 product={'name_it':name,'category':parent,'store':'Eurospin'}
 assert taxonomy.classify(product)[1]==expected,(name,taxonomy.classify(product))

dessert={'name_it':'Merendina alla vaniglia','category':'dairy','store':'Coop','url':'https://coopacasa.coopetruria.coop.it/yogurt-e-dessert/dessert/123.html'}
assert taxonomy.classify(dessert)[1]=='dairy-desserts'

root=Path(__file__).resolve().parent
products=[p for filename in taxonomy.FILES for p in json.loads((root/filename).read_text(encoding='utf-8'))]
groups=json.loads((root/'catalog-taxonomy.json').read_text(encoding='utf-8'))
children={group['id']:{child['id'] for child in group['children']} for group in groups}
assert len({p['key'] for p in products})==len(products)
for product in products:
 assert product['subcategory'] in children[product['category']]
 assert taxonomy.classify(product)==(product['category'],product['subcategory']),product['key']
assert json.loads((root/'meta.json').read_text(encoding='utf-8'))['count']==len(products)
print('Subcategory selection, complete coverage and idempotence OK:',len(products))
