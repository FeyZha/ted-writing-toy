import {useEffect,useRef,useState} from 'react';
import MaterialLibrary from './MaterialLibrary.tsx';
import PracticeWorkspace from './PracticeWorkspace.tsx';
import {apiJson} from './api.ts';
import {validMaterial} from './material.ts';
import type {PracticeMaterial} from './material.ts';

export default function App(){
  const [material,setMaterial]=useState<PracticeMaterial|null>(null);
  const [opening,setOpening]=useState(false);
  const [issue,setIssue]=useState<string|null>(null);
  const generation=useRef(0);
  const request=useRef<AbortController|null>(null);
  async function open(id:string){
    const current=++generation.current;request.current?.abort();const controller=new AbortController();request.current=controller;
    setOpening(true);setIssue(null);
    try{
      const value=await apiJson<unknown>(`/api/materials/${encodeURIComponent(id)}`,{signal:controller.signal});
      if(current!==generation.current)return;
      if(!validMaterial(value))throw Error('素材信息不完整，请重新导入。');
      setMaterial(value);const url=new URL(location.href);url.searchParams.set('material',value.id);history.replaceState(null,'',url);
    }catch(error){if(current===generation.current)setIssue(error instanceof Error?error.message:'无法打开素材，请重试。');}
    finally{if(current===generation.current)setOpening(false);}
  }
  useEffect(()=>{
    const id=new URL(location.href).searchParams.get('material');if(id)void open(id);
    return()=>{generation.current++;request.current?.abort();};
  },[]);
  function library(){setMaterial(null);setIssue(null);const url=new URL(location.href);url.searchParams.delete('material');history.replaceState(null,'',url);}
  return material?<PracticeWorkspace key={material.id} material={material} onLibrary={library}/>:<MaterialLibrary onOpen={id=>void open(id)} opening={opening} openIssue={issue}/>;
}
