// Keeps long-running Research actions visible across the Workbench's periodic inbox refresh.
// This file intentionally layers on top of workbench.js so the hotfix stays isolated and easy to remove.
(() => {
  if (!externalResearchList || !invokeCore) return;

  const inFlight = new Map();
  const actionErrors = new Map();
  const baseRefresh = refreshExternalResearchInbox;

  function actionKey(itemId, action) {
    return `${itemId}:${action}`;
  }

  function applyResearchRuntimeState() {
    for (const [key, label] of inFlight.entries()) {
      const [itemId, action] = key.split(":");
      const button = externalResearchList.querySelector(
        `[data-research-id="${itemId}"] button[data-research-action="${action}"]`
      );
      if (button) {
        button.disabled = true;
        button.textContent = label;
      }
    }

    externalResearchList.querySelectorAll("[data-research-runtime-error]").forEach(node => node.remove());
    for (const [itemId, message] of actionErrors.entries()) {
      const row = externalResearchList.querySelector(`[data-research-id="${itemId}"]`);
      const content = row?.querySelector("div");
      if (!content) continue;
      const error = document.createElement("small");
      error.dataset.researchRuntimeError = "true";
      error.textContent = `Research action failed: ${message}`;
      content.appendChild(error);
    }
  }

  refreshExternalResearchInbox = async function patchedRefreshExternalResearchInbox() {
    await baseRefresh();
    applyResearchRuntimeState();
  };

  externalResearchList.onclick = async (event) => {
    const button = event.target.closest("button[data-research-action]");
    if (!button) return;
    const row = button.closest("[data-research-id]");
    const itemId = Number(row?.dataset.researchId || 0);
    if (!itemId) return;
    const action = button.dataset.researchAction;
    const key = actionKey(itemId, action);
    if (inFlight.has(key)) return;

    try {
      actionErrors.delete(itemId);
      if (action === "analyze") {
        const ai = currentResearchAiConfig();
        if (!ai.model) throw new Error("当前 Ollama 还没有选择模型；请先在聊天窗口的 AI 设置中选择。");
        inFlight.set(key, "提取中…");
        applyResearchRuntimeState();
        await invokeCore("analyze_external_research_item", {
          itemId,
          provider: ai.provider,
          model: ai.model,
          ollamaBaseUrl: ai.ollamaBaseUrl,
        });
      } else if (action === "hypothesis") {
        const hypothesis = window.prompt("写入一个可被历史数据 / experiment 证伪的 Hypothesis：");
        if (!hypothesis) return;
        let experimentHint = "可选：关联已有 strategy experiment symbol；没有就留空。";
        try {
          const runtime = await invokeCore("get_trading_runtime_status");
          const symbols = Array.isArray(runtime?.strategyExperiments)
            ? runtime.strategyExperiments.map(item => String(item.symbol || "")).filter(Boolean)
            : [];
          if (symbols.length) experimentHint += "\n当前可选：" + symbols.slice(0, 12).join(" / ");
        } catch {}
        const linkedExperimentId = window.prompt(experimentHint, "") || "";
        inFlight.set(key, "保存中…");
        applyResearchRuntimeState();
        await invokeCore("promote_external_research_hypothesis", { itemId, hypothesis, linkedExperimentId });
      } else if (action === "status") {
        const verificationStatus = String(window.prompt(
          "Verification 状态：NEW / TRIAGED / VERIFYING / SUPPORTED / REJECTED / UNRESOLVED",
          "VERIFYING"
        ) || "").trim().toUpperCase();
        if (!verificationStatus) return;
        const researchResult = window.prompt("独立验证 / experiment 结论（可留空）：", "") || "";
        const rejectionReason = verificationStatus === "REJECTED"
          ? (window.prompt("拒绝原因：", "") || "")
          : "";
        inFlight.set(key, "保存中…");
        applyResearchRuntimeState();
        await invokeCore("set_external_research_verification", {
          itemId,
          verificationStatus,
          researchResult,
          rejectionReason,
        });
      }
    } catch (error) {
      const message = String(error || "unknown error");
      actionErrors.set(itemId, message);
      console.error("Research action failed", { itemId, action, error });
    } finally {
      inFlight.delete(key);
      await refreshExternalResearchInbox();
    }
  };

  applyResearchRuntimeState();
})();
