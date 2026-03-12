// ==UserScript==
// @name        WaniKani All Stroke Order
// @namespace   japanese
// @version     1.0.1
// @description Shows a kanji's stroke order on its page and during lessons and reviews.
// @license     GPL version 3 or any later version; http://www.gnu.org/copyleft/gpl.html
// @match       https://www.wanikani.com/*
// @match       https://preview.wanikani.com/*
// @author      Original script by: "Looki, maintained by kind users on the forum"; forked by jsmrcina. Hosted at: https://github.com/jsmrcina/WaniKaniStrokeOrder
// @grant       GM_xmlhttpRequest
// @connect     jisho.org
// @connect     cloudfront.net
// @require     https://cdnjs.cloudflare.com/ajax/libs/snap.svg/0.5.1/snap.svg-min.js
// @require     https://greasyfork.org/scripts/430565-wanikani-item-info-injector/code/WaniKani%20Item%20Info%20Injector.user.js?version=1326536

// @downloadURL https://update.greasyfork.org/scripts/569444/WaniKani%20All%20Stroke%20Order.user.js
// @updateURL https://update.greasyfork.org/scripts/569444/WaniKani%20All%20Stroke%20Order.meta.js

// ==/UserScript==

/*
 * Thanks a lot to ...
 * Wanikani Phonetic-Semantic Composition - Userscript
 * by ruipgpinheiro (LordGravewish)
 * ... for code showing me how to insert sections during kanji reviews.
 * The code heavily borrows from that script!
 * Also thanks to Halo for a loading bug fix!
 */

;(function () {
    /* global Snap */

    /*
     * Helper Functions/Variables
     */
    let wkItemInfo = unsafeWindow.wkItemInfo

    /*
     * Global Variables/Objects/Classes
     */
    const JISHO = 'https://jisho.org'
    const strokeOrderCss =
        '.stroke_order_diagram--bounding_box {fill: none; stroke: #ddd; stroke-width: 2; stroke-linecap: square; stroke-linejoin: square;}' +
        '.stroke_order_diagram--bounding_box {fill: none; stroke: #ddd; stroke-width: 2; stroke-linecap: square; stroke-linejoin: square;}' +
        '.stroke_order_diagram--existing_path {fill: none; stroke: #aaa; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round;}' +
        '.stroke_order_diagram--current_path {fill: none; stroke: #000; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round;}' +
        '.stroke_order_diagram--path_start {fill: rgba(255,0,0,0.7); stroke: none;}' +
        '.stroke_order_diagram--guide_line {fill: none; stroke: #ddd; stroke-width: 2; stroke-linecap: square; stroke-linejoin: square; stroke-dasharray: 5, 5;}' +
        '.stroke_order_loading {height: 4px; background: #e0e0e0; border-radius: 2px; overflow: hidden; margin: 8px 0;}' +
        '.stroke_order_loading--bar {height: 100%; width: 30%; background: #888; border-radius: 2px; animation: stroke_order_slide 1.5s ease-in-out infinite;}' +
        '.stroke_order_loading--error {height: auto; overflow: visible; background: none; color: #d32f2f; font-size: 14px; display: flex; align-items: center; gap: 6px;}' +
        '.stroke_order_loading--error_bar {width: 40px; height: 4px; background: #d32f2f; border-radius: 2px; flex-shrink: 0;}' +
        '@keyframes stroke_order_slide {0% {transform: translateX(-100%);} 100% {transform: translateX(433%);}}'

    init()

    /*
     * Main
     */
    function init() {
        // Lesson pages: use injector's append (creates simple h2, matches lesson structure)
        wkItemInfo.on('lesson').forType('kanji').under('composition').append('Stroke Order', loadDiagram)
        wkItemInfo.on('lesson').forType('vocabulary').under('composition').append('Stroke Order', loadVocabDiagrams)
        wkItemInfo.on('lesson').forType('radical').under('meaning').notify(loadRadicalNotify)

        // Review/quiz/study/item pages: use notify with native WaniKani HTML structure
        wkItemInfo.on('lessonQuiz, review, extraStudy, itemPage').forType('kanji').under('composition').notify(loadKanjiNative)
        wkItemInfo.on('lessonQuiz, review, extraStudy, itemPage').forType('vocabulary').under('composition').notify(loadVocabNative)
        wkItemInfo.on('lessonQuiz, review, extraStudy, itemPage').forType('radical').under('meaning').notify(loadRadicalNative)

        let style = document.createElement('style')
        style.textContent = strokeOrderCss
        document.head.appendChild(style)
    }

    function xmlHttpRequest(urlText) {
        return new Promise((resolve, reject) =>
            GM_xmlhttpRequest({
                method: 'GET',
                url: urlText,
                onload: (xhr) => {
                    xhr.status === 200 ? resolve(xhr) : reject(xhr.responseText)
                },
                onerror: (xhr) => {
                    reject(xhr.responseText)
                },
            }),
        )
    }

    function createLoadingBar() {
        let wrapper = document.createElement('div')
        wrapper.className = 'stroke_order_loading'
        let bar = document.createElement('div')
        bar.className = 'stroke_order_loading--bar'
        wrapper.append(bar)
        return wrapper
    }

    function setLoadingError(loadingEl, errorText) {
        loadingEl.className = 'stroke_order_loading stroke_order_loading--error'
        let errorBar = document.createElement('div')
        errorBar.className = 'stroke_order_loading--error_bar'
        loadingEl.replaceChildren(errorBar, errorText)
    }

    let pendingWait = null

    function waitForElement(selector) {
        if (pendingWait) {
            pendingWait.disconnect()
            pendingWait = null
        }
        return new Promise(resolve => {
            let fresh = selector + ':not([data-stroke-order-seen])'
            let el = document.querySelector(fresh)
            if (el) {
                el.setAttribute('data-stroke-order-seen', '')
                return resolve(el)
            }
            let observer = new MutationObserver(() => {
                el = document.querySelector(fresh)
                if (el) {
                    el.setAttribute('data-stroke-order-seen', '')
                    observer.disconnect()
                    pendingWait = null
                    resolve(el)
                }
            })
            observer.observe(document.body, { childList: true, subtree: true })
            pendingWait = observer
        })
    }

    /*
     * Adds the diagram section element to the appropriate location
     */
    async function fetchAndRenderStrokeOrder(character) {
        let xhr = await xmlHttpRequest(JISHO + '/search/' + encodeURI(character) + '%20%23kanji')

        let strokeOrderSvg = xhr.responseText.match(/var url = '\/\/(.+)';/)
        if (!strokeOrderSvg) return null

        xhr = await xmlHttpRequest('https://' + strokeOrderSvg[1])

        let namespace = 'http://www.w3.org/2000/svg'
        let div = document.createElement('div')
        let svg = document.createElementNS(namespace, 'svg')
        div.style = 'width: 100%; overflow: auto hidden;'
        new strokeOrderDiagram(
            svg,
            xhr.responseXML || new DOMParser().parseFromString(xhr.responseText, 'application/xml'),
        )
        div.append(svg)
        return div
    }

    function loadDiagram(injectorState) {
        let loading = createLoadingBar()
        fetchAndRenderStrokeOrder(injectorState.characters)
            .then(diagram => {
                if (diagram) loading.replaceWith(diagram)
                else setLoadingError(loading, 'No stroke order data found')
            })
            .catch(e => setLoadingError(loading, String(e)))
        return loading
    }

    function loadRadicalNotify(injectorState) {
        if (!injectorState.characters || !isKanji(injectorState.characters)) return
        let loading = createLoadingBar()
        injectorState.injector.append('Stroke Order', loading)
        fetchAndRenderStrokeOrder(injectorState.characters)
            .then(diagram => {
                if (diagram) loading.replaceWith(diagram)
                else setLoadingError(loading, 'No stroke order data found')
            })
            .catch(e => setLoadingError(loading, String(e)))
    }

    /*
     * Native WaniKani section creation for review/quiz/study/item pages.
     * Creates HTML that matches WaniKani's own collapsible section structure
     * so that WaniKani's CSS handles all styling automatically.
     */
    function createNativeSection(title, contentElement) {
        let ns = 'http://www.w3.org/2000/svg'
        let section = document.createElement('section')
        section.className = 'subject-section subject-section--collapsible'

        let h2 = document.createElement('h2')
        h2.className = 'subject-section__title'

        let toggle = document.createElement('a')
        toggle.className = 'subject-section__toggle'
        toggle.setAttribute('aria-expanded', 'true')

        let iconSpan = document.createElement('span')
        iconSpan.className = 'subject-section__toggle-icon'
        let svg = document.createElementNS(ns, 'svg')
        svg.classList.add('wk-icon', 'wk-icon--chevron_right')
        svg.setAttribute('viewBox', '0 0 320 512')
        svg.setAttribute('aria-hidden', 'true')
        svg.style.width = '1em'
        svg.style.height = '1em'
        let use = document.createElementNS(ns, 'use')
        use.setAttribute('href', '#wk-icon__chevron-right')
        svg.append(use)
        iconSpan.append(svg)

        let textSpan = document.createElement('span')
        textSpan.className = 'subject-section__title-text'
        textSpan.textContent = title

        toggle.append(iconSpan, textSpan)
        h2.append(toggle)

        let content = document.createElement('section')
        content.className = 'subject-section__content'
        content.append(contentElement)

        section.setAttribute('expanded', '')
        section.append(h2, content)

        toggle.addEventListener('click', (e) => {
            e.preventDefault()
            let expanded = toggle.getAttribute('aria-expanded') === 'true'
            toggle.setAttribute('aria-expanded', expanded ? 'false' : 'true')
            content.hidden = expanded
            if (expanded) section.removeAttribute('expanded')
            else section.setAttribute('expanded', '')
        })

        return section
    }

    function loadKanjiNative(injectorState) {
        let loading = createLoadingBar()
        let section = createNativeSection('Stroke Order', loading)
        waitForElement('.subject-section--meaning').then(target => target.before(section))

        fetchAndRenderStrokeOrder(injectorState.characters)
            .then(diagram => {
                if (diagram) loading.replaceWith(diagram)
                else setLoadingError(loading, 'No stroke order data found')
            })
            .catch(e => setLoadingError(loading, String(e)))
    }

    function loadVocabNative(injectorState) {
        let kanjiChars = (injectorState.composition || [])
            .map(k => k.characters)
            .filter(c => c && isKanji(c))
        if (kanjiChars.length === 0) return

        let container = document.createElement('div')
        let entries = kanjiChars.map(char => {
            let label = document.createElement('h3')
            label.textContent = char
            label.style.cssText = 'margin: 0.5em 0 0.25em 0; font-size: 1.2em;'
            let loading = createLoadingBar()
            container.append(label, loading)
            return { char, label, loading }
        })

        let section = createNativeSection('Stroke Order', container)
        waitForElement('.subject-section--meaning').then(target => target.before(section))

        ;(async () => {
            for (let entry of entries) {
                try {
                    let diagram = await fetchAndRenderStrokeOrder(entry.char)
                    if (diagram) entry.loading.replaceWith(diagram)
                    else setLoadingError(entry.loading, 'No stroke order data found')
                } catch (e) {
                    setLoadingError(entry.loading, String(e))
                }
            }
        })()
    }

    function loadRadicalNative(injectorState) {
        if (!injectorState.characters || !isKanji(injectorState.characters)) return

        let loading = createLoadingBar()
        let section = createNativeSection('Stroke Order', loading)
        waitForElement('.subject-section--meaning').then(target => target.before(section))

        fetchAndRenderStrokeOrder(injectorState.characters)
            .then(diagram => {
                if (diagram) loading.replaceWith(diagram)
                else setLoadingError(loading, 'No stroke order data found')
            })
            .catch(e => setLoadingError(loading, String(e)))
    }

    function isKanji(char) {
        let code = char.charCodeAt(0)
        return (code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3400 && code <= 0x4DBF)
    }

    function loadVocabDiagrams(injectorState) {
        let kanjiChars = (injectorState.composition || [])
            .map(k => k.characters)
            .filter(c => c && isKanji(c))

        if (kanjiChars.length === 0) return null

        let container = document.createElement('div')
        let entries = kanjiChars.map(char => {
            let label = document.createElement('h3')
            label.textContent = char
            label.style.cssText = 'margin: 0.5em 0 0.25em 0; font-size: 1.2em;'
            let loading = createLoadingBar()
            container.append(label, loading)
            return { char, label, loading }
        })

        ;(async () => {
            for (let entry of entries) {
                try {
                    let diagram = await fetchAndRenderStrokeOrder(entry.char)
                    if (diagram) entry.loading.replaceWith(diagram)
                    else setLoadingError(entry.loading, 'No stroke order data found')
                } catch (e) {
                    setLoadingError(entry.loading, String(e))
                }
            }
        })()

        return container
    }

    /*
     * Lifted from jisho.org, modified to allow multiple rows
     */
    var strokeOrderDiagram = function (element, svgDocument) {
        var s = Snap(element)
        var diagramSize = 200
        var coordRe = '(?:\\d+(?:\\.\\d+)?)'
        var strokeRe = new RegExp('^[LMT]\\s*(' + coordRe + ')[,\\s](' + coordRe + ')', 'i')
        var f = Snap(svgDocument.getElementsByTagName('svg')[0])
        var allPaths = f.selectAll('path')
        var drawnPaths = []
        var framesPerRow = 10
        var rowCount = Math.floor((allPaths.length - 1) / framesPerRow) + 1
        var canvasWidth = (Math.min(framesPerRow, allPaths.length) * diagramSize) / 2
        var frameSize = diagramSize / 2
        var canvasHeight = frameSize * rowCount
        var frameOffsetMatrix = new Snap.Matrix()
        frameOffsetMatrix.translate(-frameSize / 16 + 2, -frameSize / 16 + 2)

        // Set drawing area
        s.node.style.width = canvasWidth + 'px'
        s.node.style.height = canvasHeight + 'px'
        s.node.setAttribute('viewBox', '0 0 ' + canvasWidth + ' ' + canvasHeight)

        // Draw global guides
        var boundingBoxTop = s.line(1, 1, canvasWidth - 1, 1)
        var boundingBoxLeft = s.line(1, 1, 1, canvasHeight - 1)
        for (var i = 0; i < rowCount; i++) {
            var horizontalY = frameSize / 2 + i * frameSize
            var horizontalGuide = s.line(0, horizontalY, canvasWidth, horizontalY)
            horizontalGuide.attr({ class: 'stroke_order_diagram--guide_line' })
            var boundingBoxBottom = s.line(1, frameSize * (i + 1) - 1, canvasWidth - 1, frameSize * (i + 1) - 1)
            boundingBoxBottom.attr({ class: 'stroke_order_diagram--bounding_box' })
        }
        boundingBoxTop.attr({ class: 'stroke_order_diagram--bounding_box' })
        boundingBoxLeft.attr({ class: 'stroke_order_diagram--bounding_box' })

        // Draw strokes
        var pathNumber = 1
        allPaths.forEach(function (currentPath) {
            var effectivePathNumber = ((pathNumber - 1) % framesPerRow) + 1
            var effectiveY = Math.floor((pathNumber - 1) / framesPerRow) * frameSize
            var moveFrameMatrix = new Snap.Matrix()
            moveFrameMatrix.translate(frameSize * (effectivePathNumber - 1) - 4, -4 + effectiveY)

            // Draw frame guides
            var verticalGuide = s.line(
                frameSize * effectivePathNumber - frameSize / 2,
                1,
                frameSize * effectivePathNumber - frameSize / 2,
                canvasHeight - 1,
            )
            var frameBoxRight = s.line(
                frameSize * effectivePathNumber - 1,
                1,
                frameSize * effectivePathNumber - 1,
                canvasHeight - 1,
            )
            verticalGuide.attr({ class: 'stroke_order_diagram--guide_line' })
            frameBoxRight.attr({ class: 'stroke_order_diagram--bounding_box' })

            // Draw previous strokes
            drawnPaths.forEach(function (existingPath) {
                var localPath = existingPath.clone()
                localPath.transform(moveFrameMatrix)
                localPath.attr({ class: 'stroke_order_diagram--existing_path' })
                s.append(localPath)
            })

            // Draw current stroke
            currentPath.transform(frameOffsetMatrix)
            currentPath.transform(moveFrameMatrix)
            currentPath.attr({ class: 'stroke_order_diagram--current_path' })
            s.append(currentPath)

            // Draw stroke start point
            var match = strokeRe.exec(currentPath.node.getAttribute('d'))
            var pathStartX = match[1]
            var pathStartY = match[2]
            var strokeStart = s.circle(pathStartX, pathStartY, 4)
            strokeStart.attr({ class: 'stroke_order_diagram--path_start' })
            strokeStart.transform(moveFrameMatrix)

            pathNumber++
            drawnPaths.push(currentPath.clone())
        })
    }
})()
