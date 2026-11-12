import { l as uiText } from '../../../../src/i18n.js';
import {useEffect,useRef,useState} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OBJLoader} from 'three/addons/loaders/OBJLoader.js';
import {STLLoader} from 'three/addons/loaders/STLLoader.js';
import {PLYLoader} from 'three/addons/loaders/PLYLoader.js';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

export default function ModelPreview({base,extension}:{base:string;extension:string}){
  const ref=useRef<HTMLDivElement>(null),reset=useRef<()=>void>(()=>{});const [error,setError]=useState(''),[busy,setBusy]=useState(true);
  useEffect(()=>{
    const container=ref.current!,abort=new AbortController();let disposed=false,ready=false,renderer:THREE.WebGLRenderer,controls:OrbitControls,observer:ResizeObserver,theme:MutationObserver;
    const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(45,1,.01,100000);const resources=new Set<any>();
    function disposeObject(root:THREE.Object3D){root.traverse((node:any)=>{node.geometry?.dispose();for(const mat of Array.isArray(node.material)?node.material:[node.material])if(mat){for(const v of Object.values(mat))if((v as any)?.isTexture)(v as THREE.Texture).dispose();mat.dispose()}})}
    const render=()=>{if(!disposed&&ready&&renderer)renderer.render(scene,camera)};
    const capture=()=>render();window.addEventListener('moki:capture-preview',capture);
    void(async()=>{
      try{
        renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.toneMapping=THREE.ACESFilmicToneMapping;container.append(renderer.domElement);
        controls=new OrbitControls(camera,renderer.domElement);controls.addEventListener('change',render);
        const manager=new THREE.LoadingManager();manager.setURLModifier(url=>{
          if(url.startsWith('data:')||url.startsWith('blob:'))return url;
          if(!url.startsWith(base))throw Error(uiText("模型包含外部资源，请将贴图放在模型所在文件夹内"));
          return base+'preview-asset?path='+encodeURIComponent(url.slice(base.length));
        });
        const response=await fetch(base+'preview',{signal:abort.signal});if(!response.ok)throw Error(uiText("模型文件读取失败"));const data=await response.arrayBuffer();if(disposed)return;
        let object:THREE.Object3D;
        if(extension==='glb'||extension==='gltf')object=(await new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder).parseAsync(data,base)).scene;
        else if(extension==='obj'){
          const parsed=new OBJLoader(manager).parse(new TextDecoder().decode(data));parsed.updateMatrixWorld(true);
          const parts:THREE.BufferGeometry[]=[];
          parsed.traverse((node:any)=>{if(!node.isMesh)return;let geometry=node.geometry.clone();if(geometry.index){const original=geometry;geometry=geometry.toNonIndexed();original.dispose()}geometry.applyMatrix4(node.matrixWorld);for(const name of Object.keys(geometry.attributes))if(!['position','normal'].includes(name))geometry.deleteAttribute(name);if(!geometry.attributes.normal)geometry.computeVertexNormals();geometry.clearGroups();parts.push(geometry)});
          if(parts.length){const geometry=mergeGeometries(parts);for(const part of parts)part.dispose();disposeObject(parsed);if(!geometry)throw Error(uiText("OBJ 几何数据不兼容"));object=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:0xa7b4cc,roughness:.8,side:THREE.DoubleSide}))}else object=parsed;
        }
        else if(extension==='fbx')object=new FBXLoader(manager).parse(data,base);
        else {const geometry=extension==='stl'?new STLLoader().parse(data):new PLYLoader().parse(data);geometry.computeVertexNormals();object=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:0x9baaca,roughness:.7,metalness:.12,vertexColors:!!geometry.attributes.color,side:THREE.DoubleSide}))}
        if(disposed){disposeObject(object);return}
        scene.add(object);scene.add(new THREE.HemisphereLight(0xffffff,0x646c82,2.5));const key=new THREE.DirectionalLight(0xffffff,3);key.position.set(3,5,4);scene.add(key);
        const box=new THREE.Box3().setFromObject(object),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3()),extent=Math.max(size.x,size.y,size.z)||1;
        // Normalize geospatial exports before drawing: city meshes often have
        // million-unit coordinates, which lose precision in the GPU depth buffer.
        object.position.sub(center).divideScalar(extent);object.scale.multiplyScalar(1/extent);camera.near=.001;camera.far=100;camera.updateProjectionMatrix();
        reset.current=()=>{const distance=1.4/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*Math.min(1,camera.aspect));camera.position.set(.7,.9,1).normalize().multiplyScalar(distance);controls.target.set(0,0,0);controls.update();render()};
        const resize=()=>{const {width,height}=container.getBoundingClientRect();renderer.setSize(width,height);camera.aspect=width/Math.max(1,height);camera.updateProjectionMatrix();render()};
        observer=new ResizeObserver(resize);observer.observe(container);theme=new MutationObserver(render);theme.observe(document.documentElement,{attributes:true,attributeFilter:['data-color-scheme']});resize();ready=true;reset.current();setBusy(false);
      }catch(e){if(!disposed){setError(e instanceof Error?e.message:uiText("模型预览失败"));setBusy(false)}}
    })();
    return()=>{disposed=true;window.removeEventListener('moki:capture-preview',capture);abort.abort();observer?.disconnect();theme?.disconnect();controls?.dispose();disposeObject(scene);renderer?.dispose();renderer?.forceContextLoss();container.replaceChildren();resources.clear()};
  },[base,extension]);
  return <><div className="library-extra-toolbar"><small>{uiText("拖动旋转 · 滚轮缩放 · 右键平移")}{extension==='obj'?uiText(" · OBJ 几何预览"):''}</small><button onClick={()=>reset.current()}>{uiText("重置视角")}</button></div><div ref={ref} className="library-extra-model" aria-label={uiText("3D 模型预览")}/>{busy&&<div role="status" className="library-extra-toolbar">{uiText("正在加载模型…")}</div>}{error&&<p role="alert" className="library-extra-toolbar">{error}{uiText("；可使用默认应用打开完整模型。")}</p>}</>;
}
