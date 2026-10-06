const path=require('node:path');
const {openDatabase}=require('./db');
const {createCatalogService}=require('./catalog-service');
const {createKitService}=require('./kit-service');

const developmentSuppliers=[
  {name:'BelEnergy',slug:'belenergy'},
  {name:'Aldo Solar',slug:'aldo-solar'},
  {name:'PHB',slug:'phb'},
  {name:'HELTE',slug:'helte'},
  {name:'Solfácil',slug:'solfacil'}
];

const developmentProducts=[
  {category:'MODULE',manufacturer:'DEV',model:'DEV Module 610W',description:'DADO DE DESENVOLVIMENTO — não representa produto ou preço comercial.',specifications:{developmentOnly:true,powerWp:610}},
  {category:'MODULE',manufacturer:'DEV',model:'DEV Module 625W',description:'DADO DE DESENVOLVIMENTO — não representa produto ou preço comercial.',specifications:{developmentOnly:true,powerWp:625}},
  {category:'INVERTER',manufacturer:'DEV',model:'DEV Inverter 5kW',description:'DADO DE DESENVOLVIMENTO — não representa produto ou preço comercial.',specifications:{developmentOnly:true,nominalPowerW:5000}},
  {category:'INVERTER',manufacturer:'DEV',model:'DEV Inverter 8kW',description:'DADO DE DESENVOLVIMENTO — não representa produto ou preço comercial.',specifications:{developmentOnly:true,nominalPowerW:8000}}
];

const developmentKits=[
  {
    name:'DEV Kit 4.88 kWp',slug:'dev-kit-4-88-kwp',nominalPowerWp:4880,phaseType:'BIPHASIC',voltage:'127/220 V',roofType:'ROOF',
    description:'DADO DE DESENVOLVIMENTO — composição técnica sem oferta ou preço comercial.',
    items:[{productCategory:'MODULE',productManufacturer:'DEV',productModel:'DEV Module 610W',quantity:8,role:'MODULE'},{productCategory:'INVERTER',productManufacturer:'DEV',productModel:'DEV Inverter 5kW',quantity:1,role:'INVERTER'}]
  },
  {
    name:'DEV Kit 8.125 kWp',slug:'dev-kit-8-125-kwp',nominalPowerWp:8125,phaseType:'BIPHASIC',voltage:'127/220 V',roofType:'ROOF',
    description:'DADO DE DESENVOLVIMENTO — composição técnica sem oferta ou preço comercial.',
    items:[{productCategory:'MODULE',productManufacturer:'DEV',productModel:'DEV Module 625W',quantity:13,role:'MODULE'},{productCategory:'INVERTER',productManufacturer:'DEV',productModel:'DEV Inverter 8kW',quantity:1,role:'INVERTER'}]
  }
];

function seedDevelopmentCatalog(db){
  const service=createCatalogService(db);
  const kitService=createKitService(db);
  let suppliersCreated=0,productsCreated=0;
  let kitsCreated=0,kitItemsCreated=0;
  for(const input of developmentSuppliers){
    if(!service.findSupplierBySlug(input.slug)){
      try{service.createSupplier({...input,integrationType:'manual'});suppliersCreated++;}
      catch(error){if(!service.findSupplierBySlug(input.slug))throw error;}
    }
  }
  for(const input of developmentProducts){
    if(!service.findProduct(input.category,input.manufacturer,input.model)){
      try{service.createProduct(input);productsCreated++;}
      catch(error){if(!service.findProduct(input.category,input.manufacturer,input.model))throw error;}
    }
  }
  for(const input of developmentKits){
    let kit=kitService.findKitBySlug(input.slug);
    if(!kit){
      try{kit=kitService.createKit({...input,items:undefined,active:false});kitsCreated++;}
      catch(error){kit=kitService.findKitBySlug(input.slug);if(!kit)throw error;}
    }
    for(const item of input.items){
      const product=service.findProduct(item.productCategory,item.productManufacturer,item.productModel);
      const current=kit.items.find(existing=>existing.productId===product.id&&existing.role===item.role);
      if(!current){
        try{kitService.addKitItem(kit.id,{productId:product.id,quantity:item.quantity,role:item.role});kitItemsCreated++;}
        catch(error){if(!kitService.getKit(kit.id).items.some(existing=>existing.productId===product.id&&existing.role===item.role))throw error;}
      }
    }
    kit=kitService.getKit(kit.id);
    if(!kit.active)kitService.updateKit(kit.id,{active:true});
  }
  return {suppliersCreated,productsCreated,kitsCreated,kitItemsCreated,suppliersTotal:developmentSuppliers.length,productsTotal:developmentProducts.length,kitsTotal:developmentKits.length,pricesCreated:0};
}

if(require.main===module){
  const dataDir=process.env.SOLARPRO_DATA_DIR||path.join(__dirname,'.data');
  const db=openDatabase(dataDir);
  try{console.log(JSON.stringify(seedDevelopmentCatalog(db)));}
  finally{db.close();}
}

module.exports={developmentSuppliers,developmentProducts,developmentKits,seedDevelopmentCatalog};
