/**
 * Browser half of dsh-busy-light.
 *
 * A frame-wide "busy board" registered into `shell.overlay`:
 *   - blue chip = Session is running, nothing for you to do
 *   - amber chip with a 「待审批 / 待回答 / 待确认」tag = Session is blocked on
 *     you; louder breath, sorted first, red stays reserved for real errors
 *   - green chip = a background Session finished and you have not looked at it
 *     yet (`completionUnread`), so it stays until you open that Session
 *   - the browser tab mirrors the same counts (🔵 / 🟠 / 🟢) and shows a
 *     breathing badge on the brand favicon
 *
 * Live data arrives through the slot's standard `useSessions` and
 * `useSessionStatus` hooks; the component owns no subscriptions and never sees ctx.
 */
window.__ModuleLoader__.load({
  id: 'dsh-busy-light',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    /** Surface in the tooltip and the console so a stale bundle is obvious. */
    const VERSION = '0.9.0'

    const RUNNING_MARK = '\u{1F535}' // 🔵
    const WAITING_MARK = '\u{1F7E0}' // 🟠
    const DONE_MARK = '\u{1F7E2}' // 🟢
    const ERROR_MARK = '\u{1F534}' // 🔴 (reserved: no error state in SessionStatus yet)
    const RUNNING_FALLBACK = '#4176e6'
    const WAITING_FALLBACK = '#f59e0b'
    const DONE_FALLBACK = '#10b981'
    const ERROR_FALLBACK = '#ef4444'
    /** Visible chips (waiting, running, then finished); the rest collapse to one. */
    const MAX_CHIPS = 6
    /** Interactions the shell itself surfaces in a Session row. */
    const PENDING_LABELS = { approval: '待审批', question: '待回答', 'plan-review': '待确认' }

    const CSS_KEY = 'dsh-busy-light/style'
    const STYLE_SELECTOR = 'style[data-plugin-css="dsh-busy-light/style"]'
    const FAVICON_ATTR = 'data-dsh-busy-light'

    const css = `
      .dsh-busy-light{position:fixed;right:22px;bottom:22px;z-index:2147483000;display:flex;flex-direction:column;align-items:flex-start;gap:2px;box-sizing:border-box;pointer-events:none;user-select:none;white-space:nowrap;font:600 13.5px/1.2 "Segoe UI","PingFang SC","Microsoft YaHei",system-ui,sans-serif;letter-spacing:.01em;padding:6px;border-radius:14px;background:rgba(255,255,255,.86);background:color-mix(in srgb,var(--dsw-alias-bg-base,#ffffff) 86%,transparent);-webkit-backdrop-filter:blur(14px) saturate(1.3);backdrop-filter:blur(14px) saturate(1.3);border:1px solid var(--dsw-alias-border-l1,rgba(17,24,39,.1));box-shadow:0 16px 44px rgba(0,0,0,.18)}
      .dsh-busy-light[data-busy="false"]{padding:4px}
      .dsh-busy-light[data-dragging="true"],.dsh-busy-light[data-dragging="true"] .dsh-busy-light-chip{cursor:grabbing}
      .dsh-busy-light[data-dragging="true"] .dsh-busy-light-label{pointer-events:none}
      .dsh-busy-light-chip{appearance:none;-webkit-appearance:none;display:flex;align-items:center;gap:9px;max-width:320px;padding:5px 12px 5px 7px;border-radius:9px;box-sizing:border-box;background:transparent;color:var(--dsw-alias-label-primary,#111827);border:1px solid transparent;transition:background-color .25s ease,border-color .25s ease;pointer-events:auto;cursor:grab;font:inherit;text-align:left;letter-spacing:inherit;touch-action:none}
      .dsh-busy-light-chip:hover{background:var(--dsw-alias-bg-l2,rgba(17,24,39,.07))}
      .dsh-busy-light-chip:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4176e6);outline-offset:1px}
      .dsh-busy-light-chip[data-static="true"]{pointer-events:none;cursor:default;background:transparent}
      .dsh-busy-light-chip[data-state="more"]{cursor:pointer;color:var(--dsw-alias-label-secondary,#4b5563);font-size:12px;padding:4px 12px}
      .dsh-busy-light-chip[data-state="more"]:hover{background:var(--dsw-alias-bg-l2,rgba(17,24,39,.07))}
      .dsh-busy-light-chip[data-state="running"] .dsh-busy-light-label{color:var(--dsw-alias-state-business-primary,#4176e6)}
      .dsh-busy-light-chip[data-state="waiting"]{background:rgba(245,158,11,.13);border-color:rgba(245,158,11,.4);animation:dsh-busy-light-urgent 1.3s ease-in-out infinite}
      .dsh-busy-light-chip[data-state="waiting"] .dsh-busy-light-label{color:var(--dsw-alias-state-warn-label,#b45309)}
      .dsh-busy-light-chip[data-state="done"] .dsh-busy-light-label{color:#059669}
      .dsh-busy-light-chip[data-state="context"]{color:var(--dsw-alias-label-tertiary,#6b7280)}
      .dsh-busy-light-chip[data-state="context"] .dsh-busy-light-label{color:var(--dsw-alias-label-tertiary,#6b7280)}
      .dsh-busy-light-chip[data-state="context"] .dsh-busy-light-core{background:var(--dsw-alias-border-l2,#9ca3af);box-shadow:none}
      .dsh-busy-light[data-expanded="true"]{max-height:min(72vh,560px);overflow-y:auto}
      .dsh-busy-light-chip[data-sub="true"]{padding:3px 10px 3px 6px;gap:8px;font-size:12.5px;color:var(--dsw-alias-label-secondary,#4b5563)}
      .dsh-busy-light-chip[data-sub="true"] .dsh-busy-light-orb{width:16px;height:16px}
      .dsh-busy-light-chip[data-sub="true"] .dsh-busy-light-core{inset:2px}
      .dsh-busy-light-chip[data-sub="true"] .dsh-busy-light-ripple{inset:2px}
      .dsh-busy-light-orb{position:relative;display:block;flex:none;width:22px;height:22px}
      .dsh-busy-light-core{position:absolute;inset:3px;display:block;border-radius:50%;background:#10b981;box-shadow:0 0 10px 2px rgba(16,185,129,.8);transition:background-color .4s ease,box-shadow .4s ease}
      .dsh-busy-light-chip[data-state="running"] .dsh-busy-light-core{background:var(--dsw-alias-state-business-primary,#4176e6);box-shadow:0 0 16px 4px rgba(65,118,230,.85);animation:dsh-busy-light-breathe 1.2s ease-in-out infinite}
      .dsh-busy-light-chip[data-state="waiting"] .dsh-busy-light-core{background:var(--dsw-alias-state-warn-primary,#f59e0b);box-shadow:0 0 18px 5px rgba(245,158,11,.9);animation:dsh-busy-light-breathe .9s ease-in-out infinite}
      .dsh-busy-light-ripple{position:absolute;inset:3px;display:block;border-radius:50%;opacity:0;background:radial-gradient(circle,rgba(65,118,230,.7) 0%,rgba(65,118,230,0) 70%)}
      .dsh-busy-light-chip[data-state="running"] .dsh-busy-light-ripple{animation:dsh-busy-light-ripple 1.7s ease-out infinite}
      .dsh-busy-light-chip[data-state="waiting"] .dsh-busy-light-ripple{background:radial-gradient(circle,rgba(245,158,11,.85) 0%,rgba(245,158,11,0) 70%);animation:dsh-busy-light-ripple 1.05s ease-out infinite}
      .dsh-busy-light-tree{display:flex;flex-direction:column;align-items:flex-start;gap:2px}
      .dsh-busy-light-children{position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:2px;margin-left:18px;padding-left:18px}
      .dsh-busy-light-children::before{content:'';position:absolute;left:0;top:-2px;bottom:11px;border-left:1px solid var(--dsw-alias-border-l2,rgba(17,24,39,.2))}
      .dsh-busy-light-children > *{position:relative}
      .dsh-busy-light-children > *::before{content:'';position:absolute;left:-18px;top:50%;width:18px;border-top:1px solid var(--dsw-alias-border-l2,rgba(17,24,39,.2))}
      .dsh-busy-light-parent{flex:none;max-width:120px;overflow:hidden;text-overflow:ellipsis;font-size:11px;font-weight:600;color:var(--dsw-alias-label-tertiary,#6b7280)}
      .dsh-busy-light-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dsh-busy-light-tag{flex:none;padding:1px 7px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0;background:rgba(245,158,11,.14);color:var(--dsw-alias-state-warn-label,#b45309);border:1px solid rgba(245,158,11,.45)}
      @keyframes dsh-busy-light-breathe{0%,100%{transform:scale(.78);opacity:.55}50%{transform:scale(1.2);opacity:1}}
      @keyframes dsh-busy-light-ripple{0%{transform:scale(.9);opacity:.9}100%{transform:scale(2.6);opacity:0}}
      @keyframes dsh-busy-light-urgent{0%,100%{box-shadow:0 0 0 1px rgba(245,158,11,.14)}50%{box-shadow:0 0 0 1px rgba(245,158,11,.5),0 0 16px 2px rgba(245,158,11,.3)}}
      @media (prefers-reduced-motion:reduce){.dsh-busy-light-chip[data-state="running"] .dsh-busy-light-core,.dsh-busy-light-chip[data-state="waiting"] .dsh-busy-light-core{animation-duration:3.2s}.dsh-busy-light-chip[data-state="waiting"]{animation:none}}
    `

    /** Inject the plugin stylesheet once (idempotent across HMR reloads). */
    function ensureStyle() {
      if (document.querySelector(STYLE_SELECTOR) !== null) return
      const style = document.createElement('style')
      style.dataset.pluginCss = CSS_KEY
      style.textContent = css
      document.head.appendChild(style)
    }

    // --- board placement ----------------------------------------------------

    const POSITION_KEY = 'dsh-busy-light:position'
    const VIEWPORT_MARGIN = 8
    /** null keeps the stylesheet's bottom-right anchor. */
    let boardX = null
    let boardY = null
    let dragState = null
    let swallowClick = null
    let resizeBound = false

    function readStoredPosition() {
      try {
        const raw = window.localStorage.getItem(POSITION_KEY)
        if (raw === null) return null
        const value = JSON.parse(raw)
        if (value === null || typeof value !== 'object') return null
        if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) return null
        return { x: value.x, y: value.y }
      } catch {
        return null
      }
    }

    function writeStoredPosition() {
      try {
        if (boardX === null || boardY === null) window.localStorage.removeItem(POSITION_KEY)
        else window.localStorage.setItem(POSITION_KEY, JSON.stringify({ x: boardX, y: boardY }))
      } catch {
        /* storage may be denied; the position then lives for this page only */
      }
    }

    function clampBoard(x, y, width, height) {
      const maxX = Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN)
      const maxY = Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN)
      return {
        x: Math.round(Math.min(Math.max(VIEWPORT_MARGIN, x), maxX)),
        y: Math.round(Math.min(Math.max(VIEWPORT_MARGIN, y), maxY)),
      }
    }

    /** Paint the stored position onto the board node; CSS keeps the default anchor. */
    function dressBoard(node) {
      if (boardX === null || boardY === null) return
      node.style.left = boardX + 'px'
      node.style.top = boardY + 'px'
      node.style.right = 'auto'
      node.style.bottom = 'auto'
    }

    function boardStyle() {
      return boardX === null || boardY === null
        ? undefined
        : { left: boardX + 'px', top: boardY + 'px', right: 'auto', bottom: 'auto' }
    }

    function moveDrag(event) {
      if (dragState === null || event.pointerId !== dragState.pointerId) return
      const dx = event.clientX - dragState.startX
      const dy = event.clientY - dragState.startY
      if (!dragState.moved && Math.hypot(dx, dy) < 4) return
      if (!dragState.moved) {
        dragState.moved = true
        dragState.node.setAttribute('data-dragging', 'true')
      }
      const next = clampBoard(
        dragState.originX + dx,
        dragState.originY + dy,
        dragState.width,
        dragState.height,
      )
      boardX = next.x
      boardY = next.y
      dressBoard(dragState.node)
      event.preventDefault()
    }

    function endDrag(event) {
      if (dragState === null) return
      if (event !== undefined && event.pointerId !== undefined && event.pointerId !== dragState.pointerId) return
      const { moved, node } = dragState
      dragState = null
      window.removeEventListener('pointermove', moveDrag, true)
      window.removeEventListener('pointerup', endDrag, true)
      window.removeEventListener('pointercancel', endDrag, true)
      node.removeAttribute('data-dragging')
      if (!moved) return
      writeStoredPosition()
      // A drag must not also open the Session under the pointer.
      swallowClick = (clickEvent) => {
        clickEvent.preventDefault()
        clickEvent.stopPropagation()
        dropSwallow()
      }
      window.addEventListener('click', swallowClick, true)
      setTimeout(dropSwallow, 400)
    }

    function dropSwallow() {
      if (swallowClick === null) return
      window.removeEventListener('click', swallowClick, true)
      swallowClick = null
    }

    function beginDrag(event) {
      if (dragState !== null) return
      if (event.button !== 0 && event.pointerType !== 'touch') return
      const node = event.currentTarget
      const rect = node.getBoundingClientRect()
      dragState = {
        node,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: rect.left,
        originY: rect.top,
        width: rect.width,
        height: rect.height,
        moved: false,
      }
      window.addEventListener('pointermove', moveDrag, true)
      window.addEventListener('pointerup', endDrag, true)
      window.addEventListener('pointercancel', endDrag, true)
    }

    /** Keep a dragged board inside a resized viewport. */
    function ensureResizeClamp() {
      if (resizeBound || typeof window === 'undefined') return
      resizeBound = true
      window.addEventListener('resize', () => {
        const node = document.querySelector('.dsh-busy-light')
        if (node === null || boardX === null || boardY === null) return
        const rect = node.getBoundingClientRect()
        const next = clampBoard(boardX, boardY, rect.width, rect.height)
        if (next.x === boardX && next.y === boardY) return
        boardX = next.x
        boardY = next.y
        dressBoard(node)
        writeStoredPosition()
      })
    }

    // --- session model ------------------------------------------------------

    function labelOf(summary, id) {
      // Subagents are named by their durable creation label, the same word the
      // sidebar chat tab and the subagent switcher show; the projected title may
      // be inherited text that would read as the parent.
      const subagentLabel = summary === null || summary === undefined
        || summary.projectionValues === null || summary.projectionValues === undefined
        || summary.projectionValues.subagent === null || summary.projectionValues.subagent === undefined
        ? undefined
        : summary.projectionValues.subagent.label
      if (summary !== null && summary !== undefined && summary.origin === 'subagent'
        && typeof subagentLabel === 'string' && subagentLabel.trim() !== '') {
        return subagentLabel.trim()
      }
      const title = summary === null || summary === undefined ? undefined : summary.displayTitle
      return typeof title === 'string' && title.length > 0 ? title : id
    }

    /** Map one `useSessionStatus` row to the interaction word the HUD shows. */
    function pendingLabelOf(status) {
      const interaction = status === null || status === undefined ? undefined : status.pendingInteraction
      const kind = interaction === null || interaction === undefined ? undefined : interaction.kind
      return typeof kind === 'string' && Object.hasOwn(PENDING_LABELS, kind) ? PENDING_LABELS[kind] : undefined
    }

    function statusFor(statuses, id) {
      if (statuses === null || statuses === undefined || typeof statuses.get !== 'function') return undefined
      const status = statuses.get(id)
      return status === null || typeof status !== 'object' ? undefined : status
    }

    /**
     * Build the view model from one SessionListState snapshot plus the unified
     * Session status. Pure: "finished" follows `completionUnread`, so a green
     * chip disappears exactly when the user opens that Session, never on a timer.
     * @param state - SessionListState, or anything when the hook is missing.
     * @param statuses - SessionStatusSnapshot (Map), or anything when missing.
     */
    function buildModel(state, statuses, expanded) {
      const byId = state !== null && typeof state === 'object'
        && state.byId !== null && typeof state.byId === 'object' ? state.byId : {}
      const ids = state !== null && typeof state === 'object' && Array.isArray(state.ids) ? state.ids : []

      // Host list order first, then any retained row only present in byId.
      const order = []
      const listed = new Set()
      for (const id of ids) {
        if (byId[id] !== undefined && !listed.has(id)) {
          order.push(id)
          listed.add(id)
        }
      }
      for (const id in byId) {
        if (!listed.has(id)) {
          order.push(id)
          listed.add(id)
        }
      }

      const waiting = []
      const running = []
      const done = []
      for (const id of order) {
        const summary = byId[id]
        const status = statusFor(statuses, id)
        const isRunning = status !== undefined && typeof status.running === 'boolean'
          ? status.running
          : summary.running === true
        const pending = pendingLabelOf(status)
        const label = labelOf(summary, id)
        const sub = summary.origin === 'subagent'
        const parentId = typeof summary.parentId === 'string' && summary.parentId.length > 0
          ? summary.parentId
          : undefined
        const parentLabel = parentId === undefined || byId[parentId] === undefined
          ? undefined
          : labelOf(byId[parentId], parentId)
        const chip = { id, label, sub, pending, state: undefined, parentId, parentLabel }
        if (pending !== undefined) {
          waiting.push({ ...chip, state: 'waiting' })
        } else if (isRunning) {
          running.push({ ...chip, state: 'running' })
        } else if (status !== undefined && status.completionUnread === true) {
          done.push({ ...chip, state: 'done' })
        }
      }

      // A Session is not "done" while its own subagents are still working or
      // waiting: its tree is unfinished, so it stays a muted context row.
      const activeAncestors = new Set()
      for (const chip of waiting.concat(running)) {
        let parentId = chip.parentId
        while (parentId !== undefined && !activeAncestors.has(parentId)) {
          activeAncestors.add(parentId)
          const summary = byId[parentId]
          if (summary === undefined) break
          parentId = typeof summary.parentId === 'string' && summary.parentId.length > 0
            ? summary.parentId
            : undefined
        }
      }
      const settledDone = done.filter(chip => !activeAncestors.has(chip.id))
      const demotedDone = done
        .filter(chip => activeAncestors.has(chip.id))
        .map(chip => ({ ...chip, state: 'context', context: true }))

      // A subagent always hangs off its Session, even when their states differ:
      // the tree is structural, only the roots split into state sections.
      const all = waiting.concat(running, settledDone, demotedDone)
      const members = new Map(all.map(chip => [chip.id, chip]))

      // The parent may have left the board (viewed, or it finished first): keep the
      // ancestors as muted context rows so a child never floats without its top.
      for (const chip of all) {
        let parentId = chip.parentId
        while (parentId !== undefined && !members.has(parentId)) {
          const summary = byId[parentId]
          if (summary === undefined) break
          const grandId = typeof summary.parentId === 'string' && summary.parentId.length > 0
            ? summary.parentId
            : undefined
          if (grandId === parentId) break
          const contextChip = {
            id: parentId,
            label: labelOf(summary, parentId),
            sub: summary.origin === 'subagent',
            pending: undefined,
            state: 'context',
            parentId: grandId,
            parentLabel: undefined,
            context: true,
          }
          members.set(parentId, contextChip)
          parentId = grandId
        }
      }

      const childrenOf = new Map()
      for (const chip of members.values()) {
        if (chip.parentId === undefined || chip.parentId === chip.id) continue
        if (!members.has(chip.parentId)) continue
        const bucket = childrenOf.get(chip.parentId) ?? []
        bucket.push(chip)
        childrenOf.set(chip.parentId, bucket)
      }
      const SECTION_RANK = { waiting: 0, running: 1, done: 2, context: 3 }
      const rankOf = new Map()
      const rank = (chip) => {
        const cached = rankOf.get(chip.id)
        if (cached !== undefined) return cached
        rankOf.set(chip.id, SECTION_RANK[chip.state] ?? 3)
        let value = SECTION_RANK[chip.state] ?? 3
        for (const child of childrenOf.get(chip.id) ?? []) value = Math.min(value, rank(child))
        rankOf.set(chip.id, value)
        return value
      }
      const roots = [...members.values()]
        .filter(chip => chip.parentId === undefined || chip.parentId === chip.id || !members.has(chip.parentId))
        .sort((left, right) => rank(left) - rank(right))
      const tree = []
      const visited = new Set()
      const emit = (chip) => {
        if (visited.has(chip.id)) return
        visited.add(chip.id)
        tree.push(chip)
        for (const child of childrenOf.get(chip.id) ?? []) emit(child)
      }
      for (const root of roots) emit(root)

      // Expanding shows the whole tree; the compact seat otherwise stops at six.
      const limit = expanded === true ? 40 : MAX_CHIPS
      const chips = tree.slice(0, limit)
      const hidden = tree.length - chips.length
      const places = new Map(chips.map((chip, index) => [chip.id, index]))
      for (const chip of chips) {
        const parentPlace = chip.parentId === undefined ? undefined : places.get(chip.parentId)
        chip.nested = chip.sub === true && parentPlace !== undefined && parentPlace < places.get(chip.id)
        chip.showParent = chip.sub === true && chip.nested !== true && chip.parentLabel !== undefined
      }
      // The browser tab speaks for root Sessions only: a subagent's work is the
      // parent Session's work, so it must not double the counts.
      const tab = { waiting: 0, running: 0, done: 0 }
      for (const root of roots) {
        if (root.sub === true || root.state === 'context') continue
        tab[root.state] += 1
      }

      const sig = chips
        .map(chip => `${chip.state}:${chip.id}:${chip.label}:${chip.sub === true ? 's' : ''}:${chip.pending ?? ''}:${chip.nested === true ? 'n' : ''}:${chip.showParent === true ? 'p' : ''}`)
        .join('|')
        + `|hidden:${hidden}|waiting:${waiting.length}|running:${running.length}|done:${settledDone.length}`
        + `|tab:${tab.waiting},${tab.running},${tab.done}`

      return {
        waiting,
        running,
        done: settledDone,
        tab,
        chips,
        hidden,
        total: tree.length,
        expanded: expanded === true,
        busy: waiting.length > 0 || running.length > 0,
        sig,
      }
    }

    // --- browser tab --------------------------------------------------------

    const TITLE_PREFIX_RE = /^(?:[\u{1F534}\u{1F7E0}\u{1F535}\u{1F7E1}\u{1F7E2}]\d+(?:\s[\u{1F534}\u{1F7E0}\u{1F535}\u{1F7E1}\u{1F7E2}]\d+)*)\s·\s/u

    let titleNode = null
    let titleObserver = null
    let titlePrefix = ''

    function stripTitlePrefix(text) {
      return String(text).replace(TITLE_PREFIX_RE, '')
    }

    /** Compose the tab prefix; waiting leads because it is the actionable part. */
    function tabPrefix(waitingCount, runningCount, doneCount) {
      const parts = []
      if (waitingCount > 0) parts.push(WAITING_MARK + waitingCount)
      if (runningCount > 0) parts.push(RUNNING_MARK + runningCount)
      if (doneCount > 0) parts.push(DONE_MARK + doneCount)
      return parts.length === 0 ? '' : parts.join(' ') + ' · '
    }

    /**
     * Re-apply the prefix after anyone else rewrites the title (the shell owns
     * the base title). Idempotent, so our own write cannot loop the observer.
     */
    function writeTitle() {
      if (titleNode === null) return
      const base = stripTitlePrefix(titleNode.textContent || '')
      const desired = titlePrefix + base
      if (titleNode.textContent !== desired) titleNode.textContent = desired
    }

    function ensureTitleBridge() {
      if (titleObserver !== null) return
      titleNode = document.querySelector('title')
      if (titleNode === null) {
        titleNode = document.createElement('title')
        document.head.appendChild(titleNode)
      }
      titleObserver = new MutationObserver(() => {
        const current = document.querySelector('title')
        if (current !== null) titleNode = current
        writeTitle()
      })
      titleObserver.observe(document.head, { childList: true, characterData: true, subtree: true })
    }

    function setTitlePrefix(prefix) {
      titlePrefix = prefix
      ensureTitleBridge()
      writeTitle()
    }

    // --- favicon ------------------------------------------------------------

    const FAVICON_FRAMES = {
      waiting: [{ alpha: 1, radius: 15 }, { alpha: 0.4, radius: 18 }],
      running: [{ alpha: 1, radius: 15 }, { alpha: 0.5, radius: 18 }],
      done: [{ alpha: 1, radius: 15 }],
    }
    const FAVICON_PERIOD = { waiting: 760, running: 1000, done: 0 }

    let faviconMode = ''
    let faviconFrame = 0
    let faviconTimer = null
    let faviconPeriod = 0
    let brandImage
    let brandLoading = null
    const faviconCache = new Map()
    /** Icon links we took over; restored when the light idles or unloads. */
    let hijackedIcons = null
    let tabObserver = null

    function prefersReducedMotion() {
      return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches === true
    }

    function prefersDark() {
      return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches === true
    }

    /** Theme-aware state color for the canvas, with a static fallback. */
    function stateColor(name, fallback) {
      if (typeof getComputedStyle !== 'function' || document.documentElement === null) return fallback
      const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
      return value.length > 0 ? value : fallback
    }

    function colorFor(mode) {
      if (mode === 'waiting') return stateColor('--dsw-alias-state-warn-primary', WAITING_FALLBACK)
      if (mode === 'running') return stateColor('--dsw-alias-state-business-primary', RUNNING_FALLBACK)
      if (mode === 'done') return stateColor('--dsw-alias-state-success-primary', DONE_FALLBACK)
      return stateColor('--dsw-alias-state-error-primary', ERROR_FALLBACK)
    }

    function loadBrand() {
      if (brandLoading !== null) return brandLoading
      brandLoading = new Promise((resolve) => {
        if (typeof Image !== 'function') {
          resolve(null)
          return
        }
        const image = new Image()
        image.decoding = 'async'
        image.onload = () => { resolve(image) }
        image.onerror = () => { resolve(null) }
        image.src = prefersDark() ? '/favicon-dark.svg' : '/favicon.svg'
      }).then((image) => {
        brandImage = image
        return image
      })
      return brandLoading
    }

    /**
     * Take over every existing `rel=icon` link's href. Appending one more link
     * is not enough: Chromium may keep the shipped icon, and only rewriting the
     * candidates it already knows guarantees the tab repaints.
     */
    function takeOverIcons() {
      if (hijackedIcons !== null) return
      hijackedIcons = Array.from(document.querySelectorAll('link[rel~="icon"]')).map(link => ({
        link,
        href: link.getAttribute('href'),
        type: link.getAttribute('type'),
        tagged: link.hasAttribute(FAVICON_ATTR),
        created: false,
      }))
      if (hijackedIcons.length === 0) {
        const link = document.createElement('link')
        link.rel = 'icon'
        document.head.appendChild(link)
        hijackedIcons.push({ link, href: null, type: null, tagged: false, created: true })
      }
      for (const entry of hijackedIcons) entry.link.setAttribute(FAVICON_ATTR, '')
    }

    function restoreIcons() {
      if (hijackedIcons === null) return
      for (const entry of hijackedIcons) {
        if (entry.created) {
          entry.link.remove()
          continue
        }
        if (entry.href === null) entry.link.removeAttribute('href')
        else entry.link.setAttribute('href', entry.href)
        if (entry.type === null) entry.link.removeAttribute('type')
        else entry.link.setAttribute('type', entry.type)
        if (!entry.tagged) entry.link.removeAttribute(FAVICON_ATTR)
      }
      hijackedIcons = null
      faviconCache.clear()
    }

    function drawGlyph(ctx, glyph, cx, cy) {
      ctx.strokeStyle = '#ffffff'
      ctx.fillStyle = '#ffffff'
      ctx.lineWidth = 3.5
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      if (glyph === 'check') {
        ctx.beginPath()
        ctx.moveTo(cx - 7, cy)
        ctx.lineTo(cx - 2, cy + 5)
        ctx.lineTo(cx + 8, cy - 7)
        ctx.stroke()
      } else if (glyph === 'bang') {
        ctx.beginPath()
        ctx.moveTo(cx, cy - 8)
        ctx.lineTo(cx, cy + 1)
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(cx, cy + 6, 2.4, 0, Math.PI * 2)
        ctx.fill()
      } else {
        ctx.beginPath()
        ctx.arc(cx, cy, 4, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    function drawBadge(ctx, color, cx, cy, radius, alpha, glyph) {
      ctx.globalAlpha = alpha
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(cx, cy, radius, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.lineWidth = 4
      ctx.strokeStyle = 'rgba(255,255,255,.95)'
      ctx.beginPath()
      ctx.arc(cx, cy, radius, 0, Math.PI * 2)
      ctx.stroke()
      drawGlyph(ctx, glyph, cx, cy)
    }

    /** SVG fallback so the tab still changes when canvas is unavailable (tests, odd engines). */
    function fallbackIcon(color, glyph) {
      const mark = glyph === 'check'
        ? '<path d="M11 20l5 5 11-12" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>'
        : glyph === 'bang'
          ? '<path d="M20 12v8" stroke="#fff" stroke-width="5" stroke-linecap="round"/><circle cx="20" cy="27" r="2.6" fill="#fff"/>'
          : '<circle cx="20" cy="20" r="5" fill="#fff"/>'
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">`
        + `<circle cx="20" cy="20" r="18" fill="${color}"/>${mark}</svg>`
      return `data:image/svg+xml,${encodeURIComponent(svg)}`
    }

    function drawFavicon() {
      const glyph = faviconMode === 'waiting' ? 'bang' : faviconMode === 'done' ? 'check' : 'dot'
      const color = colorFor(faviconMode)
      const frames = FAVICON_FRAMES[faviconMode] ?? FAVICON_FRAMES.done
      const frame = frames[faviconFrame % frames.length]
      const canvas = document.createElement('canvas')
      canvas.width = 64
      canvas.height = 64
      const ctx = canvas.getContext('2d')
      if (ctx === null) return fallbackIcon(color, glyph)
      if (brandImage !== null && brandImage !== undefined && brandImage.naturalWidth > 0) {
        ctx.drawImage(brandImage, 0, 0, 64, 64)
        drawBadge(ctx, color, 45, 45, frame.radius, frame.alpha, glyph)
      } else {
        drawBadge(ctx, color, 32, 32, 24, frame.alpha, glyph)
      }
      return canvas.toDataURL('image/png')
    }

    function faviconUrl() {
      const key = `${faviconMode}|${faviconFrame}|${
        brandImage === undefined ? 'u' : brandImage === null ? 'n' : 'b'}`
      const cached = faviconCache.get(key)
      if (cached !== undefined) return cached
      const url = drawFavicon()
      faviconCache.set(key, url)
      return url
    }

    function paintFavicon() {
      if (hijackedIcons === null) return
      const url = faviconUrl()
      for (const entry of hijackedIcons) {
        // Writing an identical href would feed the head observer forever.
        if (entry.link.getAttribute('href') !== url) entry.link.setAttribute('href', url)
        if (entry.link.getAttribute('type') !== 'image/png') entry.link.setAttribute('type', 'image/png')
      }
    }

    /** The shell may recreate its icon links (navigation, theme sync): re-adopt them. */
    function ensureIconTakeover() {
      if (hijackedIcons !== null && hijackedIcons.every(entry => entry.link.isConnected)) return
      hijackedIcons = null
      takeOverIcons()
    }

    /** Re-assert the tab decoration after anyone rewrites the head. */
    function refreshTabDecoration() {
      if (titlePrefix !== '') writeTitle()
      if (faviconMode === '') return
      ensureIconTakeover()
      paintFavicon()
    }

    /** Coming back to the tab should show the bright frame, not a dim mid-breath one. */
    function restoreTabAttention() {
      faviconFrame = 0
      refreshTabDecoration()
    }

    function ensureTabObserver() {
      if (tabObserver !== null) return
      tabObserver = new MutationObserver(() => { refreshTabDecoration() })
      tabObserver.observe(document.head, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['href', 'rel'],
      })
      document.addEventListener('visibilitychange', restoreTabAttention)
      window.addEventListener('focus', restoreTabAttention)
    }

    function stopFaviconTimer() {
      if (faviconTimer !== null) {
        clearInterval(faviconTimer)
        faviconTimer = null
      }
      faviconPeriod = 0
    }

    function stopFavicon() {
      stopFaviconTimer()
      faviconMode = ''
      faviconFrame = 0
      restoreIcons()
    }

    function publishFavicon(mode) {
      ensureTabObserver()
      if (mode === '') {
        stopFavicon()
        return
      }
      if (faviconMode !== mode) faviconFrame = 0
      faviconMode = mode
      ensureIconTakeover()
      paintFavicon()

      const period = FAVICON_PERIOD[mode]
      if (period > 0 && !prefersReducedMotion()) {
        if (faviconTimer === null || faviconPeriod !== period) {
          stopFaviconTimer()
          faviconPeriod = period
          faviconTimer = setInterval(() => {
            faviconFrame = (faviconFrame + 1) % 2
            // Each breath also proves the shell still shows our links.
            ensureIconTakeover()
            paintFavicon()
          }, period)
        }
      } else {
        stopFaviconTimer()
      }

      // The brand glyph arrives asynchronously; repaint once it does.
      loadBrand().then(() => {
        if (faviconMode === '') return
        faviconCache.clear()
        paintFavicon()
      })
    }

    function publishTab(model) {
      setTitlePrefix(tabPrefix(model.tab.waiting, model.tab.running, model.tab.done))
      if (model.tab.waiting > 0) publishFavicon('waiting')
      else if (model.tab.running > 0) publishFavicon('running')
      else if (model.tab.done > 0) publishFavicon('done')
      else publishFavicon('')
    }

    // --- navigation ---------------------------------------------------------

    /** Set from the uiWorkspace injection; a no-op until that service is ready. */
    let openSession = () => {}

    // --- rendering ----------------------------------------------------------

    function orbElement(chip) {
      return h(
        'span',
        { className: 'dsh-busy-light-orb' },
        chip.state === 'waiting' || chip.state === 'running'
          ? h('span', { className: 'dsh-busy-light-ripple' })
          : null,
        h('span', { className: 'dsh-busy-light-core' }),
      )
    }

    function chipElement(chip) {
      let title = chip.label
      if (chip.state === 'waiting') title += ' · ' + chip.pending
      if (chip.state === 'context') title += ' · 子代理仍在运行'
      if (chip.sub && chip.parentLabel !== undefined) title += ' · 属于 ' + chip.parentLabel
      return h(
        'button',
        {
          type: 'button',
          className: 'dsh-busy-light-chip',
          'data-state': chip.state,
          'data-sub': chip.sub ? 'true' : 'false',
          'data-nested': chip.nested ? 'true' : 'false',
          key: chip.id + ':' + chip.state,
          title: title + ' · 点击打开',
          'aria-label': '打开会话 ' + title,
          onClick: () => { openSession(chip.id) },
        },
        orbElement(chip),
        h('span', { className: 'dsh-busy-light-label' }, chip.sub ? '↳ ' + chip.label : chip.label),
        chip.state === 'waiting' ? h('span', { className: 'dsh-busy-light-tag' }, chip.pending) : null,
        chip.showParent ? h('span', { className: 'dsh-busy-light-parent' }, '· ' + chip.parentLabel) : null,
      )
    }

    function ariaLabelOf(model) {
      const parts = []
      if (model.waiting.length > 0) parts.push('待操作 ' + model.waiting.length + ' 个会话')
      if (model.running.length > 0) parts.push('运行中 ' + model.running.length + ' 个会话')
      if (model.done.length > 0) parts.push('已完成 ' + model.done.length + ' 个会话')
      return parts.length > 0 ? parts.join('，') : '全部完成'
    }

    function renderLight(model, setExpanded) {
      const children = []
      if (model.chips.length === 0) {
        children.push(h(
          'div',
          { className: 'dsh-busy-light-chip', 'data-state': 'done', 'data-static': 'true', key: 'idle', title: '全部完成' },
          h('span', { className: 'dsh-busy-light-orb' }, h('span', { className: 'dsh-busy-light-core' })),
          h('span', { className: 'dsh-busy-light-label' }, '已完成'),
        ))
      } else {
        // Subagents hang off their parent as a branch, so the tree reads as one.
        const childrenOf = new Map()
        for (const chip of model.chips) {
          if (chip.nested !== true) continue
          const bucket = childrenOf.get(chip.parentId) ?? []
          bucket.push(chip)
          childrenOf.set(chip.parentId, bucket)
        }
        const renderNode = (chip) => {
          const button = chipElement(chip)
          const kids = childrenOf.get(chip.id)
          if (kids === undefined || kids.length === 0) return button
          return h(
            'div',
            { className: 'dsh-busy-light-tree', key: chip.id + ':' + chip.state },
            button,
            h('div', { className: 'dsh-busy-light-children' }, kids.map(renderNode)),
          )
        }
        for (const chip of model.chips) {
          if (chip.nested === true) continue
          children.push(renderNode(chip))
        }
        if (model.hidden > 0) {
          children.push(h(
            'button',
            {
              type: 'button',
              className: 'dsh-busy-light-chip',
              'data-state': 'more',
              key: 'more',
              title: '展开其余 ' + model.hidden + ' 个会话',
              'aria-label': '展开其余 ' + model.hidden + ' 个会话',
              onClick: () => { setExpanded(true) },
            },
            h('span', { className: 'dsh-busy-light-label' }, '还有 ' + model.hidden + ' 个会话 ▾'),
          ))
        } else if (model.expanded === true && model.total > MAX_CHIPS) {
          children.push(h(
            'button',
            {
              type: 'button',
              className: 'dsh-busy-light-chip',
              'data-state': 'more',
              key: 'collapse',
              title: '收起',
              'aria-label': '收起',
              onClick: () => { setExpanded(false) },
            },
            h('span', { className: 'dsh-busy-light-label' }, '收起 ▴'),
          ))
        }
      }
      const label = ariaLabelOf(model)
      return h('div', {
        className: 'dsh-busy-light',
        'data-busy': model.busy ? 'true' : 'false',
        'data-pending': model.waiting.length > 0 ? 'true' : 'false',
        'data-expanded': model.expanded ? 'true' : 'false',
        style: boardStyle(),
        onPointerDown: beginDrag,
        role: 'status',
        'aria-live': 'polite',
        'aria-label': label,
        title: label + ' · v' + VERSION + ' · 按住可拖动',
      }, children)
    }

    function BusyLight(props) {
      const useSessions = props === null || props === undefined ? undefined : props.useSessions
      const useSessionStatus = props === null || props === undefined ? undefined : props.useSessionStatus
      // Always call both selector hooks so hook order never depends on the kit.
      const useSnapshot = typeof useSessions === 'function' ? useSessions : () => undefined
      const useStatusSnapshot = typeof useSessionStatus === 'function' ? useSessionStatus : () => undefined
      const state = useSnapshot(snapshot => snapshot)
      const statuses = useStatusSnapshot(snapshot => snapshot)
      const [expanded, setExpanded] = React.useState(false)
      const model = buildModel(state, statuses, expanded)
      // Debug surface: window.__dshBusyLight.model.chips explains any row.
      if (typeof window !== 'undefined') window.__dshBusyLight = { version: VERSION, model }

      React.useEffect(() => {
        publishTab(model)
      }, [model.sig])

      // A fresh render drops imperative style attributes; repaint the stored seat.
      React.useEffect(() => {
        const node = document.querySelector('.dsh-busy-light')
        if (node !== null) dressBoard(node)
      })

      // Restore the shell's title and brand favicon when the plugin unloads.
      React.useEffect(() => () => {
        setTitlePrefix('')
        if (titleObserver !== null) {
          titleObserver.disconnect()
          titleObserver = null
        }
        if (tabObserver !== null) {
          tabObserver.disconnect()
          tabObserver = null
        }
        document.removeEventListener('visibilitychange', restoreTabAttention)
        window.removeEventListener('focus', restoreTabAttention)
        stopFavicon()
      }, [])

      return renderLight(model, setExpanded)
    }

    // `slots` is the only service this plugin touches. Never inject a name no
    // plugin provides: a pending fiber bricks the whole Web boot.
    const inject = ['slots']

    function apply(ctx) {
      ensureStyle()
      document.documentElement.dataset.dshBusyLight = VERSION
      console.info('[dsh-busy-light] v' + VERSION)
      if (typeof window !== 'undefined') {
        const stored = readStoredPosition()
        if (stored !== null) {
          boardX = stored.x
          boardY = stored.y
        }
        ensureResizeClamp()
      }
      ctx.slots.inject('shell.overlay', () => ctx.slots.register(
        {
          name: 'shell.overlay',
          id: 'dsh-busy-light',
          order: 100,
        },
        BusyLight,
      ))
      // Navigation is optional: without uiWorkspace the chips stay informational.
      ctx.inject(['uiWorkspace'], (scope) => {
        scope.effect(() => {
          openSession = (sessionId) => { scope.uiWorkspace.openSession(sessionId) }
          return () => { openSession = () => {} }
        }, 'dsh-busy-light: open Session')
      })
    }

    const plugin = { apply, inject }
    // Hermetic-test surface; not part of the plugin contract.
    Object.defineProperty(plugin, '__test', {
      value: { buildModel, tabPrefix, stripTitlePrefix },
      enumerable: false,
    })
    return plugin
  },
})

