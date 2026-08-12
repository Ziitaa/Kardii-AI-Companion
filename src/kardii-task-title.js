(() => {
  function summarizeAgentTaskTitle(value) {
    let text = String(value || "").trim();
    const requestMarker = "当前要执行的请求：";
    if (text.includes(requestMarker)) text = text.split(requestMarker)[1] || text;
    text = text.split("此前聊天上下文")[0]
      .replace(/\s+/g, " ")
      .replace(/^(?:好的?|可以|行|ok(?:ay)?)[，,。！! ]*/i, "")
      .replace(/^那(?:你)?(?:就)?[，,。！! ]*/, "")
      .replace(/^(?:我想(?:让你|请你)?|我需要你?|需要你?|想请你|麻烦你|请你?|你来|帮我|替我)[，,。！! ]*/i, "")
      .replace(/^.{0,32}?(?:找我)?(?:聊|讨论|沟通|说|提到)(?:了|一下)?(?:之前)?(?:关于)?/i, "")
      .split(/(?:[，,。；;！!？?]|然后|并且|另外|以及|还有)/)[0]
      .trim()
      .replace(/^关于/, "")
      .replace(/^把/, "")
      .replace(/入驻\s*target\s*(?:需要的|所需)?/ig, "Target 入驻")
      .replace(/\btarget\b/ig, "Target")
      .replace(/需要的/g, "所需")
      .replace(/分付款/g, "付款")
      .replace(/的(?=(?:服务协议|协议|方案|合同|付款|地址|资料|文件|设置))/g, "")
      .replace(/\s+/g, " ")
      .replace(/^[：:，,。；;\-— ]+|[：:，,。；;\-— ]+$/g, "");

    if (!text) text = "新的 Agent 任务";
    const hasTaskVerb = /^(?:整理|分析|调查|研究|检查|审核|比较|生成|制作|创建|新建|添加|修改|优化|修复|删除|清理|同步|连接|安装|运行|执行|完成|推送|发布|处理|准备|规划|回复|跟进)/.test(text);
    if (!hasTaskVerb && text.length > 10) text = `处理 ${text}`;
    const chars = [...text];
    return chars.length > 34 ? `${chars.slice(0, 34).join("")}…` : text;
  }

  window.summarizeAgentTaskTitle = summarizeAgentTaskTitle;
})();
