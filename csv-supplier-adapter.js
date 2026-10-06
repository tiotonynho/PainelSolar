'use strict';

const {SupplierAdapter}=require('./supplier-adapter');
const Core=require('./supplier-import-core');

class CsvSupplierAdapter extends SupplierAdapter{
  constructor({supplier,mapping={},defaultCurrency,decimalFormat,logger}={}){super({supplier,logger});this.mapping=mapping;this.defaultCurrency=defaultCurrency;this.decimalFormat=decimalFormat;}
  fetchCatalog(input,options={}){const parsed=Core.parseCsv(input,options);return {parsed,items:Core.normalizeRows(parsed,{mapping:this.mapping,defaultCurrency:this.defaultCurrency,decimalFormat:this.decimalFormat,now:options.now})};}
  fetchOffers(input,options={}){return this.fetchCatalog(input,options);}
  normalizeProduct(value){return value?.normalizedData||value;}
  normalizeOffer(value){return value?.normalizedData||value;}
  validateProduct(value){return {valid:value?.status!=='INVALID',errors:value?.errors||[],warnings:value?.warnings||[]};}
  validateOffer(value){return this.validateProduct(value);}
}

module.exports={CsvSupplierAdapter};
