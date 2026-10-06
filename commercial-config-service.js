'use strict';

const crypto=require('node:crypto');
const {toCents,fromCents}=require('./money');
const {PRICING_MODES,TAX_BASES,COMMISSION_BASES}=require('./pricing-config');

class CommercialConfigValidationError extends Error{
  constructor(errors){super(errors.join(' '));this.name='CommercialConfigValidationError';this.code='COMMERCIAL_CONFIG_VALIDATION';this.status=400;this.errors=errors;}
}

const text=(value,name,{required=true,max=180}={})=>{
  const result=value===undefined||value===null?'':String(value).trim();
  if(required&&!result)throw new CommercialConfigValidationError([`${name} é obrigatório.`]);
  if(result.length>max)throw new CommercialConfigValidationError([`${name} excede o limite permitido.`]);
  return result||null;
};

function rate(value,name,{nullable=true,maximum=1}={}){
  if(value===undefined||value===null||value===''){
    if(nullable)return null;
    throw new CommercialConfigValidationError([`${name} é obrigatório.`]);
  }
  const result=typeof value==='number'?value:Number(String(value).replace(',','.'));
  if(!Number.isFinite(result)||result<0||result>maximum)throw new CommercialConfigValidationError([`${name} deve estar entre 0 e ${maximum}.`]);
  return result;
}

function money(input,name){
  const centsKey=`${name}Cents`;
  if(input[centsKey]!==undefined&&input[centsKey]!==null&&input[centsKey]!==''){
    const value=Number(input[centsKey]);
    if(!Number.isSafeInteger(value)||value<0)throw new CommercialConfigValidationError([`${centsKey} inválido.`]);
    return value;
  }
  try{return toCents(input[name]??0);}catch(error){throw new CommercialConfigValidationError([`${name} inválido.`]);}
}

function normalizeConfig(input={},now=Date.now(),actorId=null){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new CommercialConfigValidationError(['Configuração comercial inválida.']);
  const pricingMode=String(input.pricingMode||PRICING_MODES.STANDARD).toUpperCase();
  if(!Object.values(PRICING_MODES).includes(pricingMode))throw new CommercialConfigValidationError(['pricingMode inválido.']);
  const defaultMarkupRate=rate(input.defaultMarkupRate,'defaultMarkupRate');
  const defaultTargetMarginRate=rate(input.defaultTargetMarginRate,'defaultTargetMarginRate');
  if(defaultMarkupRate!==null&&defaultTargetMarginRate!==null)throw new CommercialConfigValidationError(['Informe markup ou margem alvo, não ambos.']);
  const defaultCommissionRate=rate(input.defaultCommissionRate??0,'defaultCommissionRate',{nullable:false});
  const defaultTaxRate=rate(input.defaultTaxRate??0,'defaultTaxRate',{nullable:false});
  const defaultCommissionBase=input.defaultCommissionBase===undefined||input.defaultCommissionBase===null||input.defaultCommissionBase===''?null:String(input.defaultCommissionBase).toUpperCase();
  const defaultTaxBase=input.defaultTaxBase===undefined||input.defaultTaxBase===null||input.defaultTaxBase===''?null:String(input.defaultTaxBase).toUpperCase();
  if(defaultCommissionBase&&!Object.values(COMMISSION_BASES).includes(defaultCommissionBase))throw new CommercialConfigValidationError(['defaultCommissionBase inválido.']);
  if(defaultTaxBase&&!Object.values(TAX_BASES).includes(defaultTaxBase)||defaultTaxBase===TAX_BASES.LEGACY_KIT_COST)throw new CommercialConfigValidationError(['defaultTaxBase inválido.']);
  if(defaultCommissionRate>0&&!defaultCommissionBase)throw new CommercialConfigValidationError(['defaultCommissionBase é obrigatório quando há comissão.']);
  if(defaultTaxRate>0&&!defaultTaxBase)throw new CommercialConfigValidationError(['defaultTaxBase é obrigatório quando há imposto.']);
  return {
    id:input.id||crypto.randomUUID(),name:text(input.name,'name'),version:Number(input.version)||null,active:input.active===true,
    pricingMode,defaultInstallationCostCents:money(input,'defaultInstallationCost'),defaultEngineeringCostCents:money(input,'defaultEngineeringCost'),
    defaultMarkupRate,defaultTargetMarginRate,defaultCommissionRate,defaultCommissionBase,defaultTaxRate,defaultTaxBase,
    minimumMarginRate:rate(input.minimumMarginRate,'minimumMarginRate'),defaultFreightRequired:input.defaultFreightRequired===true,
    createdAt:Number(input.createdAt)||now,updatedAt:Number(input.updatedAt)||now,createdBy:input.createdBy||actorId||null
  };
}

function fromRow(row){
  if(!row)return null;
  return {
    id:row.id,name:row.name,version:row.version,active:!!row.active,pricingMode:row.pricing_mode,
    defaultInstallationCostCents:row.default_installation_cost_cents,defaultInstallationCost:fromCents(row.default_installation_cost_cents),
    defaultEngineeringCostCents:row.default_engineering_cost_cents,defaultEngineeringCost:fromCents(row.default_engineering_cost_cents),
    defaultMarkupRate:row.default_markup_rate,defaultTargetMarginRate:row.default_target_margin_rate,
    defaultCommissionRate:row.default_commission_rate,defaultCommissionBase:row.default_commission_base,
    defaultTaxRate:row.default_tax_rate,defaultTaxBase:row.default_tax_base,minimumMarginRate:row.minimum_margin_rate,
    defaultFreightRequired:!!row.default_freight_required,createdAt:row.created_at,updatedAt:row.updated_at,createdBy:row.created_by
  };
}

function createCommercialConfigService(db,{logger={info(){},warn(){}}}={}){
  const insertAudit=db.prepare('INSERT INTO commercial_config_audit(id,config_id,action,previous_config_id,new_config_id,actor_id,created_at,snapshot_json) VALUES (?,?,?,?,?,?,?,?)');
  const rowById=id=>db.prepare('SELECT * FROM commercial_configs WHERE id=?').get(id);
  const serialize=config=>JSON.stringify(config);
  function create(input,actorId){
    const now=Date.now(),config=normalizeConfig({...input,version:null,active:false},now,actorId);
    const versionRow=db.prepare('SELECT COALESCE(MAX(version),0)+1 AS version FROM commercial_configs').get();config.version=versionRow.version;
    db.exec('BEGIN IMMEDIATE');
    try{
      db.prepare(`INSERT INTO commercial_configs(id,name,version,active,pricing_mode,default_installation_cost_cents,default_engineering_cost_cents,default_markup_rate,default_target_margin_rate,default_commission_rate,default_commission_base,default_tax_rate,default_tax_base,minimum_margin_rate,default_freight_required,created_at,updated_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(config.id,config.name,config.version,0,config.pricingMode,config.defaultInstallationCostCents,config.defaultEngineeringCostCents,config.defaultMarkupRate,config.defaultTargetMarginRate,config.defaultCommissionRate,config.defaultCommissionBase,config.defaultTaxRate,config.defaultTaxBase,config.minimumMarginRate,config.defaultFreightRequired?1:0,config.createdAt,config.updatedAt,config.createdBy);
      insertAudit.run(crypto.randomUUID(),config.id,'CREATED',null,config.id,actorId,now,serialize(config));db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    logger.info?.({event:'PRICING_CONFIG_CREATED',configId:config.id,version:config.version,actorId});
    return fromRow(rowById(config.id));
  }
  function list(){return db.prepare('SELECT * FROM commercial_configs ORDER BY version DESC').all().map(fromRow);}
  function get(id){return fromRow(rowById(id));}
  function getByVersion(version){return fromRow(db.prepare('SELECT * FROM commercial_configs WHERE version=?').get(Number(version)));}
  function getActive(){return fromRow(db.prepare('SELECT * FROM commercial_configs WHERE active=1 ORDER BY version DESC LIMIT 1').get());}
  function activate(id,actorId){
    const target=rowById(id);if(!target)throw Object.assign(new Error('Configuração comercial não encontrada.'),{status:404});
    const previous=db.prepare('SELECT * FROM commercial_configs WHERE active=1 ORDER BY version DESC LIMIT 1').get();const now=Date.now();
    db.exec('BEGIN IMMEDIATE');
    try{
      db.prepare('UPDATE commercial_configs SET active=0,updated_at=?').run(now);
      db.prepare('UPDATE commercial_configs SET active=1,updated_at=? WHERE id=?').run(now,id);
      insertAudit.run(crypto.randomUUID(),id,'ACTIVATED',previous?.id||null,id,actorId,now,serialize(fromRow(rowById(id))));db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    logger.info?.({event:'PRICING_CONFIG_ACTIVATED',configId:id,version:target.version,previousConfigId:previous?.id||null,actorId});
    return get(id);
  }
  function audit(configId=null){
    const rows=configId?db.prepare('SELECT * FROM commercial_config_audit WHERE config_id=? ORDER BY created_at DESC').all(configId):db.prepare('SELECT * FROM commercial_config_audit ORDER BY created_at DESC').all();
    return rows.map(row=>({...row,snapshot:JSON.parse(row.snapshot_json)}));
  }
  return {create,list,get,getByVersion,getActive,activate,audit,normalizeConfig};
}

module.exports={CommercialConfigValidationError,normalizeConfig,createCommercialConfigService,fromRow};
