import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';

// Cached across every field using the hook — the backend probes the helper
// binary once and the result never changes for the life of the process, so
// there's no reason to re-ask per field or per keystroke.
let availabilityPromise = null;
function checkAvailability() {
  if (!availabilityPromise) {
    availabilityPromise = invoke('text_completion_available').catch(() => false);
  }
  return availabilityPromise;
}

const WORD_RE = /[\p{L}\p{N}'-]+$/u;

// Computed-style props that affect text metrics/layout — copied onto the
// ghost overlay so its text lines up character-for-character with the real
// field (font shorthand isn't reliably copyable, so list the parts).
const MIRROR_PROPS = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'letterSpacing',
  'lineHeight',
  'textTransform',
  'textIndent',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
];

function makeGhost(el) {
  const isTextarea = el.tagName === 'TEXTAREA';
  const ghost = document.createElement('div');
  ghost.setAttribute('aria-hidden', 'true');
  Object.assign(ghost.style, {
    position: 'fixed',
    pointerEvents: 'none',
    overflow: 'hidden',
    whiteSpace: isTextarea ? 'pre-wrap' : 'pre',
    wordBreak: isTextarea ? 'break-word' : 'normal',
    // border-style must be set (not just -color/-width) or the browser
    // resolves the *used* border-width to 0 for box-model math, making the
    // ghost's content box taller than the real field's and throwing off
    // both height and vertical centering.
    borderStyle: 'solid',
    borderColor: 'transparent',
    // getBoundingClientRect() (used below to size/position the ghost) is
    // always border-box, so the ghost itself must be border-box regardless
    // of what box-sizing the real field computes to.
    boxSizing: 'border-box',
    display: 'none',
    zIndex: 9999,
  });
  if (!isTextarea) {
    // <input> vertically centers its single line of text inside the box;
    // a block-flow <div> starts text at the top, which reads as the ghost
    // text floating above the real text. Flex-centering matches it.
    ghost.style.alignItems = 'center';
  }
  document.body.appendChild(ghost);
  return ghost;
}

function positionGhost(ghost, el) {
  const cs = getComputedStyle(el);
  MIRROR_PROPS.forEach((p) => {
    ghost.style[p] = cs[p];
  });
  const rect = el.getBoundingClientRect();
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = `${rect.top}px`;
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
}

/**
 * Wires macOS-native (NSSpellChecker) word-completion onto a plain
 * <input>/<textarea> ref: as the user types a word at the end of the field,
 * a suggested completion is shown as muted, semi-transparent ghost text
 * (rendered in an overlay, not selected/highlighted text) and the Right
 * Arrow key accepts it (Tab is taken by the select-next-field shortcut).
 * Any other keystroke discards it. No-ops silently if the native
 * completion engine isn't available.
 */
export function useTabCompletion(ref, enabled = true) {
  const pendingRef = useRef(null); // { word, suffix } currently shown as ghost text
  const reqIdRef = useRef(0);
  const debounceRef = useRef(null);
  const availableRef = useRef(true);

  useEffect(() => {
    if (!enabled) return undefined;
    const el = ref.current;
    if (!el) return undefined;

    checkAvailability().then((v) => {
      availableRef.current = v;
    });

    const ghost = makeGhost(el);

    const getCurrentWord = () => {
      const pos = el.selectionStart;
      // Only complete at the very end of the field — that's the only place
      // the ghost overlay's text-flow lines up with the real caret.
      if (pos !== el.selectionEnd || pos !== el.value.length) return null;
      const match = el.value.match(WORD_RE);
      if (!match) return null;
      return match[0];
    };

    const showGhost = (typed, suffix) => {
      positionGhost(ghost, el);
      ghost.innerHTML = '';
      const hidden = document.createElement('span');
      hidden.style.visibility = 'hidden';
      hidden.textContent = typed;
      const suggestion = document.createElement('span');
      suggestion.style.color = 'var(--text-muted)';
      suggestion.style.opacity = '0.65';
      suggestion.textContent = suffix;
      ghost.appendChild(hidden);
      ghost.appendChild(suggestion);
      ghost.style.display = el.tagName === 'TEXTAREA' ? 'block' : 'flex';
    };

    const clearSuggestion = () => {
      pendingRef.current = null;
      ghost.style.display = 'none';
    };

    const handleInput = () => {
      clearSuggestion();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (!availableRef.current) return;
      const word = getCurrentWord();
      if (!word || word.length < 2) return;
      const myReqId = ++reqIdRef.current;
      debounceRef.current = setTimeout(() => {
        invoke('get_text_completions', { partial: word })
          .then((completions) => {
            if (reqIdRef.current !== myReqId || !completions?.length) return;
            if (getCurrentWord() !== word) return;
            const best = completions.find(
              (c) => c.length > word.length && c.toLowerCase().startsWith(word.toLowerCase()),
            );
            if (!best) return;
            const suffix = best.slice(word.length);
            pendingRef.current = { word, suffix };
            showGhost(el.value, suffix);
          })
          .catch(() => {});
      }, 100);
    };

    const handleKeyDown = (e) => {
      if (
        e.key === 'ArrowRight' &&
        pendingRef.current &&
        getCurrentWord() === pendingRef.current.word
      ) {
        e.preventDefault();
        const { suffix } = pendingRef.current;
        const setter = Object.getOwnPropertyDescriptor(
          el.tagName === 'TEXTAREA'
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype,
          'value',
        ).set;
        const pos = el.value.length;
        setter.call(el, el.value + suffix);
        el.setSelectionRange(pos + suffix.length, pos + suffix.length);
        clearSuggestion();
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (e.key !== 'Shift') {
        clearSuggestion();
      }
    };

    const reposition = () => {
      if (ghost.style.display !== 'none') positionGhost(ghost, el);
    };

    el.addEventListener('input', handleInput);
    el.addEventListener('keydown', handleKeyDown);
    el.addEventListener('blur', clearSuggestion);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      el.removeEventListener('input', handleInput);
      el.removeEventListener('keydown', handleKeyDown);
      el.removeEventListener('blur', clearSuggestion);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      ghost.remove();
    };
  }, [ref, enabled]);
}
