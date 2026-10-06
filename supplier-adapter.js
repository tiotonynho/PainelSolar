'use strict';

class SupplierAdapter{
  constructor({supplier,logger}={}){this.supplier=supplier||null;this.logger=logger||{info(){},warn(){}};}
  async fetchCatalog(){throw new Error('Este SupplierAdapter nao implementa fetchCatalog().');}
  async fetchOffers(){throw new Error('Este SupplierAdapter nao implementa fetchOffers().');}
  normalizeProduct(value){return value;}
  normalizeOffer(value){return value;}
  validateProduct(value){return {valid:!!value,errors:[]};}
  validateOffer(value){return {valid:!!value,errors:[]};}
}

module.exports={SupplierAdapter};
