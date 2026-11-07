export async function apiJson<T>(url:string,options:RequestInit={}):Promise<T>{
  const response=await fetch(url,{...options,headers:{...options.headers,...(options.body?{'Content-Type':'application/json'}:{})}});
  let data;try{data=await response.json();}catch{throw Error('本机服务尚未就绪，请稍后重试。');}
  if(!response.ok)throw Object.assign(Error(data?.error??'操作失败，请重试。'),{status:response.status});
  return data as T;
}
export type ImportJob={id:string;status:'running'|'ready'|'failed'|'cancelled';stage:'metadata'|'subtitles'|'video'|'structure'|'clips'|'ready';progress:number;sourceUrl:string;title:string|null;materialId:string|null;error:string|null};
