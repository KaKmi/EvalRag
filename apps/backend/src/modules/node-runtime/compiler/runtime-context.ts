// 011 Design §4：executeStructured/streamText 的运行时上下文——node-runtime 不
// 查库，全部由调用方（prompts.service / applications.service）已经查好传入。
export interface RuntimeContext {
  /** intent 节点用：候选意图静态全表（014 D3：恒注入全表，非可达子集） */
  availableIntents?: Array<{ key: string; label: string; criteria: string[] }>;
  /** reply 节点用：检索命中的引用来源 */
  citations?: Array<{ n: number; doc: string; kb: string; section: string; score: number }>;
  /** true=试运行/预演，false=真实问答；透传进 span 与 fallback 文案不做区分展示 */
  preview?: boolean;
}
