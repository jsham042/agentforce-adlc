/**
 * highlight.js language definition for Agentforce Agent Script (.agent files).
 *
 * Covers the DSL constructs the ADLC author skill emits:
 *   - top-level blocks (system, config, variables, language, start_agent,
 *     topic, connection, knowledge, reasoning, actions, definitions,
 *     invocations)
 *   - variable modifiers (linked, mutable) and primitive types
 *   - Python-style booleans (True / False)
 *   - @SObject.Field references
 *   - action URI schemes (flow://, apex://, generatePromptResponse://)
 *   - instruction-resolution operators (-> procedural, | literal)
 *   - # line comments, "…" strings
 */

import type { LanguageFn } from 'highlight.js';

const agentscript: LanguageFn = (hljs) => {
  const BLOCK_KEYWORDS =
    'system config variables language connection knowledge start_agent topic ' +
    'reasoning actions definitions invocations messages instructions ' +
    'description label source visibility developer_name agent_label ' +
    'agent_type default_agent_user default_locale additional_locales ' +
    'all_additional_locales welcome error';

  return {
    name: 'Agent Script',
    aliases: ['agent', 'agentscript'],
    keywords: {
      keyword: BLOCK_KEYWORDS,
      type: 'linked mutable string number boolean object list',
      literal: 'True False null',
    },
    contains: [
      hljs.HASH_COMMENT_MODE,
      hljs.QUOTE_STRING_MODE,

      // @SObject.Field references — e.g. @MessagingSession.Id
      {
        className: 'variable',
        begin: /@[A-Za-z_][\w.]*/,
      },

      // Action target URIs — flow://Foo, apex://Bar, generatePromptResponse://Baz
      {
        className: 'link',
        begin: /\b(flow|apex|generatePromptResponse):\/\/[\w.\-\/]+/,
      },

      // Instruction-resolution operators
      {
        className: 'operator',
        begin: /->|\|/,
      },

      // `topic <name>:` — highlight the topic name as a title
      {
        className: 'title',
        begin: /(?<=\btopic\s+)[A-Za-z_]\w*/,
      },

      // Property keys at line start, e.g. `  developer_name:`
      // (lower precedence than keywords — hljs tries keywords first)
      {
        className: 'attr',
        begin: /^[\t ]*[A-Za-z_]\w*(?=:)/,
        relevance: 0,
      },
    ],
  };
};

export default agentscript;
