import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createKnowledgeExportPlan, buildKnowledgeExportVolume } from "../apps/extension/dist/knowledge-export.js";

const output = process.argv[2] || ".tmp/obsidian-performance-smoke.json";
const COUNT = Number(process.env.CV_OBSIDIAN_COUNT || 3000);
const TEXT_REPEAT = Number(process.env.CV_OBSIDIAN_TEXT_REPEAT || 80);
let activeReads = 0;
let maxConcurrentReads = 0;
let totalReads = 0;

function canonicalFor(index) {
  const conversationId = `perf-conversation-${String(index).padStart(5,"0")}`;
  const userId = `user-${index}`;
  const assistantId = `assistant-${index}`;
  const text = `Synthetic Obsidian graph payload ${index}. `.repeat(TEXT_REPEAT);
  return {
    schemaVersion: "0.1",
    conversationId,
    title: `Performance Conversation ${index}`,
    source: { provider: "chatgpt", adapter: "performance-fixture", sourceUrl: null },
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: new Date(Date.UTC(2026,6,20,0,0,index%60)).toISOString(),
    currentNodeId: assistantId,
    nodes: {
      [userId]: { nodeId:userId,parentId:null,childrenIds:[assistantId],messageId:`msg-u-${index}`,role:"user",createdAt:null,updatedAt:null,content:[{type:"text",text:`Question ${index}`,rawPayload:`Question ${index}`}],model:null,status:null,metadata:{},rawPayload:{} },
      [assistantId]: { nodeId:assistantId,parentId:userId,childrenIds:[],messageId:`msg-a-${index}`,role:"assistant",createdAt:null,updatedAt:null,content:[{type:"text",text,rawPayload:text}],model:"synthetic",status:null,metadata:{},rawPayload:{} },
    },
    edges: [{from:userId,to:assistantId}],
    activePath: [userId,assistantId],
    projectId: "performance-project",
    metadata: {},
    rawMetadata: null,
  };
}

const refs = Array.from({length:COUNT},(_,index)=>({
  key:`chatgpt:perf-conversation-${String(index+1).padStart(5,"0")}`,
  conversationId:`perf-conversation-${String(index+1).padStart(5,"0")}`,
  title:`Performance Conversation ${index+1}`,
  createdAt:"2026-07-20T00:00:00.000Z",
  updatedAt:"2026-07-26T00:00:00.000Z",
  projectId:"performance-project",
  projectTitle:"Performance Project",
  archived:false,
  currentEvidenceHash:`hash-${index+1}`,
  currentEvidenceKey:`evidence-${index+1}`,
  messageCount:2,
  activeMessageCount:2,
  sourceKinds:["synthetic"],
}));

const store = {
  async listProjectConversationRefs(){return refs;},
  async getProjectState(){return {projectId:"performance-project",projectTitle:"Performance Project",stateVersion:1,stateHash:"state-hash",updatedAt:"2026-07-26T00:00:00.000Z",status:{summary:"Performance fixture",phase:"stress",health:"healthy",progressPercent:50,blockers:[],nextActions:[]},decisions:[],tasks:[],supersessions:[]};},
  async getApprovedMemory(){return null;},
  async getKnowledgeExportProfile(){return {profile:null,pathMap:{}};},
  async getConversationDetail(key){
    activeReads+=1;totalReads+=1;maxConcurrentReads=Math.max(maxConcurrentReads,activeReads);
    const index=Number(key.slice(-5));
    try { return {conversation:refs[index-1],evidence:{canonical:canonicalFor(index)},messages:[]}; }
    finally { activeReads-=1; }
  },
};

if (global.gc) global.gc();
const heapStart=process.memoryUsage().heapUsed;
const rssStart=process.memoryUsage().rss;
const started=performance.now();
const plan=await createKnowledgeExportPlan({store,projectId:"performance-project",maxVolumeBytes:12*1024*1024,generatedAt:"2026-07-26T12:00:00.000Z"});
const planned=performance.now();
let outputBytes=0;
let maxVolumeBytes=0;
for(let number=1;number<=plan.volumeCount;number+=1){
  const volume=await buildKnowledgeExportVolume({plan,volumeNumber:number,store});
  outputBytes+=volume.blob.size;
  maxVolumeBytes=Math.max(maxVolumeBytes,volume.blob.size);
  await volume.blob.arrayBuffer();
  if(global.gc)global.gc();
}
const ended=performance.now();
const report={
  conversations:COUNT,
  nodes:plan.graph.nodes.length,
  edges:plan.graph.edges.length,
  volumes:plan.volumeCount,
  outputBytes,
  maxVolumeBytes,
  maxConcurrentConversationReads:maxConcurrentReads,
  totalConversationReads:totalReads,
  planningMilliseconds:Number((planned-started).toFixed(2)),
  buildMilliseconds:Number((ended-planned).toFixed(2)),
  heapDeltaBytes:process.memoryUsage().heapUsed-heapStart,
  rssDeltaBytes:process.memoryUsage().rss-rssStart,
  graphHash:plan.graphHash,
  status:plan.vault.report.status,
  brokenLinks:plan.vault.report.brokenLinks.length,
  invalidCanvasReferences:plan.vault.report.invalidCanvasReferences.length,
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output,`${JSON.stringify(report,null,2)}\n`);
console.log(JSON.stringify(report,null,2));
