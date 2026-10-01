using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using UnityEngine;
using UnityEditor;

// This is the only executable code copied into the isolated conversion project.
public static class LanternMetadata {
    [Serializable] public class Document { public List<Model> models=new(); public List<MaterialInfo> materials=new(); public List<Assembly> assemblies=new(); }
    [Serializable] public class Ref { public string guid; public long fileId; public string name; public string path; public string geometry; }
    [Serializable] public class Model { public string guid; public string path; public List<Ref> meshes=new(); public string[] bones; public string[] warnings; }
    [Serializable] public class TextureInfo { public string property; public string guid; public string path; public float[] scale; public float[] offset; }
    [Serializable] public class MaterialInfo { public string guid; public string name; public string path; public List<TextureInfo> textures=new(); public List<Number> numbers=new(); public List<Tint> colors=new(); public string[] keywords; }
    [Serializable] public class Number { public string name; public float value; }
    [Serializable] public class Tint { public string name; public float[] value; }
    [Serializable] public class Assembly { public string guid; public string path; public List<Node> nodes=new(); public List<string> warnings=new(); }
    [Serializable] public class Node { public string name; public int parent; public float[] position; public float[] rotation; public float[] scale; public Ref mesh; public List<string> materials=new(); public bool enabled; public List<ColliderInfo> colliders=new(); public List<Level> lods=new(); public string[] unsupported; public int[] bones; public int rootBone=-1; }
    [Serializable] public class ColliderInfo { public string type; public float[] center; public float[] size; public float radius; public float height; public int direction; public bool trigger; public Ref mesh; }
    [Serializable] public class Level { public float screenHeight; public int[] nodes; }
    [Serializable] public class Geometry { public float[] positions; public float[] normals; public float[] uv; public float[] colors; public List<Submesh> triangles=new(); public int[] joints; public float[] weights; public float[] bindposes; }
    [Serializable] public class Submesh {public int[] indices;}
    static string meshOutput;
    static HashSet<string> written=new();
    static Ref Reference(UnityEngine.Object obj, string sourceGuid=null, long localId=0) { if (!obj) return null; AssetDatabase.TryGetGUIDAndLocalFileIdentifier(obj,out string guid,out long id); if(sourceGuid!=null){guid=sourceGuid;id=localId;}
        var result=new Ref {guid=guid,fileId=id,name=obj.name,path=AssetDatabase.GetAssetPath(obj)};
        if(obj is Mesh mesh) {
            result.geometry=Path.Combine(meshOutput,guid+"-"+id+".json");
            if(written.Add(result.geometry)) {
                var data=new Geometry{positions=mesh.vertices.SelectMany(V).ToArray(),normals=mesh.normals.SelectMany(V).ToArray(),uv=mesh.uv.SelectMany(v=>new[]{v.x,v.y}).ToArray(),colors=mesh.colors.SelectMany(c=>new[]{c.r,c.g,c.b,c.a}).ToArray()};
                for(int i=0;i<mesh.subMeshCount;i++)data.triangles.Add(new Submesh{indices=mesh.GetTriangles(i)});
                var weights=mesh.boneWeights; data.joints=weights.SelectMany(w=>new[]{w.boneIndex0,w.boneIndex1,w.boneIndex2,w.boneIndex3}).ToArray();data.weights=weights.SelectMany(w=>new[]{w.weight0,w.weight1,w.weight2,w.weight3}).ToArray();
                data.bindposes=mesh.bindposes.SelectMany(m=>Enumerable.Range(0,16).Select(i=>m[i])).ToArray();
                File.WriteAllText(result.geometry,JsonUtility.ToJson(data));
            }
        }
        return result; }
    static float[] V(Vector3 v)=>new[]{v.x,v.y,v.z};
    static float[] Q(Quaternion v)=>new[]{v.x,v.y,v.z,v.w};
    public static void Export() {
        meshOutput=Environment.GetEnvironmentVariable("LANTERN_METADATA_OUTPUT")+"-meshes";Directory.CreateDirectory(meshOutput);written.Clear();
        var document=new Document();
        foreach(var guid in AssetDatabase.FindAssets("t:Model")) {
            var path=AssetDatabase.GUIDToAssetPath(guid);
            var root=AssetDatabase.LoadAssetAtPath<GameObject>(path);
            document.models.Add(new Model{guid=guid,path=path, meshes=AssetDatabase.LoadAllAssetsAtPath(path).OfType<Mesh>().Select(m=>Reference(m)).ToList(),bones=root?root.GetComponentsInChildren<SkinnedMeshRenderer>(true).SelectMany(r=>r.bones).Where(b=>b).Select(b=>b.name).Distinct().ToArray():new string[0]});
        }
        foreach(var guid in AssetDatabase.FindAssets("t:Mesh")) {
            var path=AssetDatabase.GUIDToAssetPath(guid);if(!path.EndsWith(".asset"))continue;
            var meshes=AssetDatabase.LoadAllAssetsAtPath(path).OfType<Mesh>().ToArray();if(meshes.Length==0)continue;
            document.models.Add(new Model{guid=guid,path=path,meshes=meshes.Select(m=>Reference(m)).ToList(),bones=new string[0]});
        }
        foreach(var guid in AssetDatabase.FindAssets("t:TerrainData")) {
            var path=AssetDatabase.GUIDToAssetPath(guid);var terrain=AssetDatabase.LoadAssetAtPath<TerrainData>(path);if(!terrain)continue;
            int resolution=Math.Min(513,terrain.heightmapResolution);var vertices=new Vector3[resolution*resolution];var normals=new Vector3[vertices.Length];var uv=new Vector2[vertices.Length];var triangles=new int[(resolution-1)*(resolution-1)*6];int ti=0;
            for(int z=0;z<resolution;z++)for(int x=0;x<resolution;x++) {
                float u=x/(float)(resolution-1),v=z/(float)(resolution-1);int i=z*resolution+x;
                vertices[i]=new Vector3(u*terrain.size.x,terrain.GetInterpolatedHeight(u,v),v*terrain.size.z);normals[i]=terrain.GetInterpolatedNormal(u,v);uv[i]=new Vector2(u,v);
                if(x<resolution-1&&z<resolution-1){triangles[ti++]=i;triangles[ti++]=i+resolution;triangles[ti++]=i+1;triangles[ti++]=i+1;triangles[ti++]=i+resolution;triangles[ti++]=i+resolution+1;}
            }
            var mesh=new Mesh{name=terrain.name,indexFormat=UnityEngine.Rendering.IndexFormat.UInt32};mesh.vertices=vertices;mesh.normals=normals;mesh.uv=uv;mesh.triangles=triangles;
            var reference=Reference(mesh,guid,1);reference.path=path;
            document.models.Add(new Model{guid=guid,path=path,meshes=new List<Ref>{reference},bones=new string[0],warnings=new[]{"Terrain height field exported at up to 513x513 vertices; original terrain layers and painting remain archived"}});
        }
        foreach(var guid in AssetDatabase.FindAssets("t:Material")) {
            var path=AssetDatabase.GUIDToAssetPath(guid);
            var material=AssetDatabase.LoadAssetAtPath<Material>(path);
            var info=new MaterialInfo{guid=guid,path=path,name=material.name,keywords=material.shaderKeywords};
            // Serialized properties survive absent engine-specific shaders.
            var serialized=new SerializedObject(material);
            var saved=serialized.FindProperty("m_SavedProperties");
            var textures=saved.FindPropertyRelative("m_TexEnvs");
            for(int i=0;i<textures.arraySize;i++) {
                var pair=textures.GetArrayElementAtIndex(i); var value=pair.FindPropertyRelative("second"); var texture=value.FindPropertyRelative("m_Texture").objectReferenceValue;
                var scale=value.FindPropertyRelative("m_Scale").vector2Value; var offset=value.FindPropertyRelative("m_Offset").vector2Value;
                info.textures.Add(new TextureInfo{property=pair.FindPropertyRelative("first").stringValue,guid=texture?AssetDatabase.AssetPathToGUID(AssetDatabase.GetAssetPath(texture)):null,path=texture?AssetDatabase.GetAssetPath(texture):null,scale=new[]{scale.x,scale.y},offset=new[]{offset.x,offset.y}});
            }
            foreach(var key in new[]{"m_Floats","m_Ints"}) {
                var array=saved.FindPropertyRelative(key); if(array==null)continue;
                for(int i=0;i<array.arraySize;i++){var pair=array.GetArrayElementAtIndex(i);var val=pair.FindPropertyRelative("second"); info.numbers.Add(new Number{name=pair.FindPropertyRelative("first").stringValue,value=key=="m_Ints"?val.intValue:val.floatValue});}
            }
            var colors=saved.FindPropertyRelative("m_Colors");
            for(int i=0;i<colors.arraySize;i++){var pair=colors.GetArrayElementAtIndex(i);var c=pair.FindPropertyRelative("second").colorValue;info.colors.Add(new Tint{name=pair.FindPropertyRelative("first").stringValue,value=new[]{c.r,c.g,c.b,c.a}});}
            document.materials.Add(info);
        }
        foreach(var guid in AssetDatabase.FindAssets("t:Prefab")) {
            var path=AssetDatabase.GUIDToAssetPath(guid); var prefab=AssetDatabase.LoadAssetAtPath<GameObject>(path); if(!prefab)continue;
            var assembly=new Assembly{guid=guid,path=path};
            var transforms=prefab.GetComponentsInChildren<Transform>(true); var indices=transforms.Select((t,i)=>(t,i)).ToDictionary(p=>p.t,p=>p.i);
            foreach(var t in transforms) {
                var renderer=t.GetComponent<Renderer>(); var filter=t.GetComponent<MeshFilter>(); var mesh=filter?filter.sharedMesh:null; var skin=t.GetComponent<SkinnedMeshRenderer>(); if(skin)mesh=skin.sharedMesh;
                var node=new Node{name=t.name,parent=t.parent&&indices.ContainsKey(t.parent)?indices[t.parent]:-1,position=V(t.localPosition),rotation=Q(t.localRotation),scale=V(t.localScale),enabled=t.gameObject.activeSelf,mesh=Reference(mesh)};
                if(renderer){node.materials=renderer.sharedMaterials.Select(m=>m?AssetDatabase.AssetPathToGUID(AssetDatabase.GetAssetPath(m)):null).ToList(); if(mesh&&!node.mesh.guid.Any())assembly.warnings.Add("Unresolved mesh: "+t.name);}
                if(skin){node.bones=skin.bones.Select(b=>b&&indices.ContainsKey(b)?indices[b]:-1).ToArray();node.rootBone=skin.rootBone&&indices.ContainsKey(skin.rootBone)?indices[skin.rootBone]:-1;}
                foreach(var c in t.GetComponents<Collider>()) {
                    var info=new ColliderInfo{type=c.GetType().Name,trigger=c.isTrigger};
                    if(c is BoxCollider box){info.center=V(box.center);info.size=V(box.size);} else if(c is SphereCollider sphere){info.center=V(sphere.center);info.radius=sphere.radius;} else if(c is CapsuleCollider capsule){info.center=V(capsule.center);info.radius=capsule.radius;info.height=capsule.height;info.direction=capsule.direction;} else if(c is MeshCollider mc)info.mesh=Reference(mc.sharedMesh);
                    node.colliders.Add(info);
                }
                var lod=t.GetComponent<LODGroup>();if(lod)foreach(var level in lod.GetLODs())node.lods.Add(new Level{screenHeight=level.screenRelativeTransitionHeight,nodes=level.renderers.Where(r=>r&&indices.ContainsKey(r.transform)).Select(r=>indices[r.transform]).ToArray()});
                node.unsupported=t.GetComponents<Component>().Where(c=>c&&!(c is Transform)&&!(c is MeshFilter)&&!(c is Renderer)&&!(c is Collider)&&!(c is LODGroup)).Select(c=>c.GetType().Name).ToArray();
                if(t.GetComponents<Component>().Any(c=>c==null))assembly.warnings.Add("Missing script: "+t.name);
                assembly.nodes.Add(node);
            }
            document.assemblies.Add(assembly);
        }
        var output=Environment.GetEnvironmentVariable("LANTERN_METADATA_OUTPUT");File.WriteAllText(output,JsonUtility.ToJson(document,true));
        Debug.Log($"Lantern metadata: {document.models.Count} models, {document.materials.Count} materials, {document.assemblies.Count} assemblies");
    }
}
