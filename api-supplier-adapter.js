'use strict';

const {SupplierAdapter}=require('./supplier-adapter');

class ApiSupplierAdapter extends SupplierAdapter{
  constructor({supplier,baseUrl,credentialEnv,credentialHeader='Authorization',credentialPrefix='Bearer',fetchImpl=fetch,timeoutMs=12000,maxRetries=2,logger}={}){
    super({supplier,logger});this.baseUrl=baseUrl||null;this.credentialEnv=credentialEnv||null;this.credentialHeader=credentialHeader;this.credentialPrefix=credentialPrefix;this.fetchImpl=fetchImpl;this.timeoutMs=timeoutMs;this.maxRetries=maxRetries;
  }
  async authenticate(){
    if(this.credentialEnv&&!process.env[this.credentialEnv])throw new Error(`Credencial ${this.credentialEnv} nao configurada no ambiente.`);
    return {authenticated:true};
  }
  async request(path,{method='GET',body,headers={}}={}){
    if(!this.baseUrl)throw new Error('API supplier adapter sem baseUrl configurada.');
    const url=new URL(path,this.baseUrl).toString();
    const credential=this.credentialEnv?process.env[this.credentialEnv]:null;
    let lastError;
    for(let attempt=0;attempt<=this.maxRetries;attempt++){
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.timeoutMs);
      try{
        const authHeaders=credential?{[this.credentialHeader]:this.credentialPrefix?`${this.credentialPrefix} ${credential}`:credential}:{};
        const response=await this.fetchImpl(url,{method,body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal,headers:{Accept:'application/json','Content-Type':'application/json',...authHeaders,...headers}});
        if(response.status===429||response.status>=500){lastError=new Error(`API supplier respondeu ${response.status}.`);if(attempt<this.maxRetries)continue;throw lastError;}
        if(!response.ok)throw new Error(`API supplier respondeu ${response.status}.`);
        return response.json();
      }catch(error){lastError=error;if(attempt>=this.maxRetries)throw error;}
      finally{clearTimeout(timer);}
    }
    throw lastError||new Error('Falha na API supplier.');
  }
  async fetchCatalog(path='/catalog'){await this.authenticate();return this.request(path);}
  async fetchOffers(path='/offers'){await this.authenticate();return this.request(path);}
  mapResponse(response){return response;}
}

module.exports={ApiSupplierAdapter};
