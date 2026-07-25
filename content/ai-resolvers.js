// content/ai-resolvers.js — Domain resolver loader (loaded before content.js)
// RecallFox v0.1.0
// Di-load via manifest.json sebagai script non-module (sebelum content.js)
// Karena content.js juga non-module, expose ke window.

(function () {
  // Re-declare AI_DOMAINS here (mirror of lib/domains.js)
  // karena content scripts tidak bisa import module secara langsung tanpa type=module
  // dan kita ingin tetap single-file simplicity.
  const AI_DOMAINS = [
    {
      id: 'zai',
      name: 'z.ai',
      patterns: ['chat.z.ai'],
      selectors: {
        textarea: [
          'div[contenteditable="true"]#chat-input',
          'div[contenteditable="true"][data-testid*="input"]',
          'textarea#chat-input',
          'div[contenteditable="true"]'
        ],
        sendButton: [
          'button[type="submit"]',
          'button[aria-label="Send"]',
          'button[data-testid="send-button"]',
          'button[aria-label*="send" i]'
        ],
        userMessage: [
          '[data-message-author="user"]',
          '.message-user',
          '[data-role="user"]'
        ],
        aiMessage: [
          '[data-message-author="assistant"]',
          '.message-assistant',
          '[data-role="assistant"]',
          '.markdown-body'
        ]
      }
    },
    {
      id: 'chatgpt',
      name: 'ChatGPT',
      patterns: ['chatgpt.com'],
      selectors: {
        textarea: [
          'div#prompt-textarea[contenteditable="true"]',
          'textarea#prompt-textarea',
          'div[contenteditable="true"][data-testid*="composer"]'
        ],
        sendButton: [
          'button[data-testid="send-button"]',
          'button[aria-label*="send" i]'
        ],
        userMessage: [
          '[data-message-author-role="user"]',
          'div[data-message-author="user"]'
        ],
        aiMessage: [
          '[data-message-author-role="assistant"]',
          'div[data-message-author="assistant"]'
        ]
      }
    },
    {
      id: 'claude',
      name: 'Claude',
      patterns: ['claude.ai'],
      selectors: {
        textarea: [
          'div[contenteditable="true"].ProseMirror',
          'div[contenteditable="true"][role="textbox"]',
          'div.ProseMirror[contenteditable="true"]'
        ],
        sendButton: [
          'button[aria-label="Send Message"]',
          'button[aria-label*="send" i]',
          'button[type="submit"]'
        ],
        userMessage: [
          'div[data-is-streaming][data-testid="user-message"]',
          '[data-message-author="user"]',
          'div.font-user-message'
        ],
        aiMessage: [
          'div[data-is-streaming][data-testid="ai-message"]',
          '[data-message-author="assistant"]',
          'div.font-claude-message'
        ]
      }
    },
    {
      id: 'gemini',
      name: 'Gemini',
      patterns: ['gemini.google.com'],
      selectors: {
        textarea: [
          'div.ql-editor[contenteditable="true"]',
          'rich-textarea div[contenteditable="true"]',
          'div[contenteditable="true"][aria-label*="prompt" i]'
        ],
        sendButton: [
          'button[aria-label="Send message"]',
          'button[aria-label*="send" i]',
          'mat-icon[aria-label*="send" i]'
        ],
        userMessage: [
          'message-content[data-message-id] .query-text',
          '.query-text',
          '.user-query'
        ],
        aiMessage: [
          'message-content[data-message-id] .model-response-text',
          '.model-response-text',
          '.model-response'
        ]
      }
    },
    {
      id: 'deepseek',
      name: 'DeepSeek',
      patterns: ['chat.deepseek.com'],
      selectors: {
        textarea: [
          'textarea#chat-input',
          'textarea[placeholder*="Message" i]',
          'textarea'
        ],
        sendButton: [
          'button.ds-button[type="submit"]',
          'div[role="button"][aria-label*="send" i]',
          'button[type="submit"]'
        ],
        userMessage: [
          'div[data-role="user"]',
          '.ds-message--user',
          '.message-user'
        ],
        aiMessage: [
          'div[data-role="assistant"]',
          '.ds-message--assistant',
          '.markdown-body'
        ]
      }
    },
    {
      id: 'qwen',
      name: 'Qwen',
      patterns: ['tongyi.aliyun.com', 'chat.qwen.ai'],
      selectors: {
        textarea: [
          'textarea.chat-input',
          'textarea[placeholder*="input" i]',
          'textarea'
        ],
        sendButton: [
          'button.send-btn',
          'button[type="submit"]',
          'div[role="button"][aria-label*="send" i]'
        ],
        userMessage: [
          '.message-user',
          '[data-role="user"]'
        ],
        aiMessage: [
          '.message-assistant',
          '.markdown-body',
          '[data-role="assistant"]'
        ]
      }
    },
    {
      id: 'kimi',
      name: 'Kimi',
      patterns: ['kimi.moonshot.cn', 'kimi.com'],
      selectors: {
        textarea: [
          'textarea#chat-input',
          '.chat-input textarea',
          'textarea'
        ],
        sendButton: [
          'button[type="submit"]',
          'button[aria-label*="send" i]'
        ],
        userMessage: [
          '.role-user',
          '[data-role="user"]'
        ],
        aiMessage: [
          '.role-assistant',
          '.markdown-body',
          '[data-role="assistant"]'
        ]
      }
    }
  ];

  function getDomainConfig(url) {
    url = url || location.href;
    const host = (() => {
      try { return new URL(url).hostname; } catch (e) { return url; }
    })();
    for (const d of AI_DOMAINS) {
      for (const p of d.patterns) {
        if (host === p || host.endsWith('.' + p)) return d;
      }
    }
    return null;
  }

  window.__RecallFoxDomainConfig__ = getDomainConfig();

  // v3.16.0 S2: Perluas snapshot ke SEMUA AI tools (bukan cuma 7 yang punya selectors).
  // AI_TOOLS_LIST = daftar domain semua AI tool dari lib/ai-tools.js (22 tools).
  // Kalau domain match AI_TOOLS_LIST tapi tidak ada config spesifik → pakai generic fallback.
  // Kalau domain match config spesifik → pakai config itu (selectors presisi).
  // Sebelumnya: __RecallFoxIsAIDomain__ hanya true kalau ada config spesifik (7 domain).
  // Sekarang: true kalau match AI_TOOLS_LIST (22+ domain) — snapshot bisa jalan di semua AI.
  const AI_TOOLS_DOMAINS = [
    'chatgpt.com', 'claude.ai', 'gemini.google.com', 'copilot.microsoft.com',
    'perplexity.ai', 'www.perplexity.ai', 'grok.com', 'chat.mistral.ai',
    'huggingface.co', 'pi.ai', 'you.com', 'arena.ai', 'chat.lmsys.org', 'lmsys.org',
    'chat.z.ai', 'chat.deepseek.com', 'tongyi.aliyun.com', 'chat.qwen.ai',
    'kimi.com', 'kimi.moonshot.cn', 'doubao.com', 'www.doubao.com',
    'chatglm.cn', 'yiyan.baidu.com', 'yuanbao.tencent.com',
    'baichuan-ai.com', 'www.baichuan-ai.com', 'chat.minimaxi.com', 'hailuoai.com',
    'chat.sensetime.com'
  ];
  const currentHost = location.hostname;
  const isAiToolDomain = AI_TOOLS_DOMAINS.some(d => currentHost === d || currentHost.endsWith('.' + d));

  // Generic fallback config — dipakai kalau domain AI tool tapi tidak ada selectors spesifik
  const GENERIC_FALLBACK_CONFIG = {
    id: 'generic',
    name: 'AI Chat (generic)',
    patterns: AI_TOOLS_DOMAINS,
    selectors: {
      textarea: [
        'div[contenteditable="true"][role="textbox"]',
        'textarea[data-testid*="input" i]',
        'textarea[placeholder*="message" i]',
        'textarea[placeholder*="ask" i]',
        'textarea',
        'div[contenteditable="true"]'
      ],
      sendButton: [
        'button[type="submit"]',
        'button[aria-label*="send" i]',
        'button[aria-label*="submit" i]',
        'button[data-testid*="send" i]'
      ],
      userMessage: [
        '[data-message-author-role="user"]',
        '[data-message-author="user"]',
        '.user-message', '.message-user',
        '[data-role="user"]',
        '[class*="user"][class*="message"]'
      ],
      aiMessage: [
        '[data-message-author-role="assistant"]',
        '[data-message-author="assistant"]',
        '.assistant-message', '.message-assistant',
        '[data-role="assistant"]',
        '[class*="assistant"][class*="message"]',
        '[class*="ai"][class*="message"]',
        '.markdown-body'
      ]
    }
  };

  // Set config: pakai spesifik kalau ada, kalau tidak pakai generic fallback
  if (!window.__RecallFoxDomainConfig__ && isAiToolDomain) {
    window.__RecallFoxDomainConfig__ = GENERIC_FALLBACK_CONFIG;
  }
  // __RecallFoxIsAIDomain__ = true kalau ada config (spesifik ATAU generic)
  window.__RecallFoxIsAIDomain__ = !!window.__RecallFoxDomainConfig__ && isAiToolDomain;
})();
