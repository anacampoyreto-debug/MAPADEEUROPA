const select = (query) => document.querySelector(query);
const panel = select('#panel');
const frame = select('#map-frame');
const svg = select('#overlay');
const marker = select('#quiz-marker');
const mapImage = select('#map-image');
const sourceToggle = select('#source-toggle');
const storageKey = 'europa-fisica-estudio-v1';
const soundKey = 'europa-fisica-sonido';
const soundToggle = select('#sound-toggle');
const correctSound = select('#correct-sound');

let soundEnabled = true;
try { soundEnabled = localStorage.getItem(soundKey) !== 'off'; } catch {}
let progress = {};
try { progress = JSON.parse(localStorage.getItem(storageKey)) || {}; } catch {}
let mode = 'explore';
let category = 'agua';
let explored = null;
let showSource = false;
let session = null;
let cursor = null;

const normalize = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().trim().replace(/[.,-]/g, ' ').replace(/\s+/g, ' ');
const accepts = (place, value) => {
  const strip = (name) => normalize(name).replace(/^(?:rio |mar (?:de |del )?|oceano |montes )/, '');
  const entered = strip(value);
  return [place.name, ...place.aliases].some((name) => strip(name) === entered);
};

function record(question, correct) {
  const {place, kind} = question;
  progress[place.id] ||= {};
  progress[place.id][kind] = correct;
  try { localStorage.setItem(storageKey, JSON.stringify(progress)); } catch {}
}

function missed() {
  return places.flatMap((place) => ['locate', 'name']
    .filter((kind) => progress[place.id]?.[kind] === false).map((kind) => ({place, kind})));
}

function updateProgress() {
  const mastered = places.filter(({id}) => progress[id]?.locate && progress[id]?.name).length;
  select('#mastery-text').textContent = `${mastered} de ${places.length} dominados`;
  select('#mastery-bar').max = places.length;
  select('#mastery-bar').value = mastered;
  select('#review-count').textContent = missed().length || '';
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function setMode(next) {
  mode = next;
  session = null;
  cursor = null;
  showSource = false;
  document.querySelectorAll('[data-mode]').forEach((button) => {
    if (button.dataset.mode === mode) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  render();
}

function options() {
  return '<option value="all">Todo el mapa</option>' + Object.entries(categories)
    .map(([key, [label]]) => `<option value="${key}">${label}</option>`).join('');
}

function start(questions) {
  session = {questions, index: 0, answers: [], checked: false, attempts: 0, usedHint: false, result: null};
  cursor = null;
  render(true);
}

function current() {
  return session?.questions[session.index];
}

function render(focus = false) {
  updateProgress();
  if (mode === 'explore') {
    panel.innerHTML = `<h2 id="panel-title">Explora el mapa</h2>
      <p class="muted">Elige un grupo y pulsa un nombre para ver dónde está.</p>
      <label for="category">Grupo de lugares</label><select id="category">${options()}</select>
      <div class="place-list" aria-label="Lugares">${places.filter((place) => category === 'all' || place.type === category)
        .map((place) => `<button type="button" data-place="${place.id}" aria-pressed="${explored === place}">${place.name}</button>`).join('')}</div>
      <span class="feedback" id="study-note" aria-live="polite"></span>`;
    select('#category').value = category;
    select('#category').onchange = (event) => { category = event.target.value; explored = null; render(); select('#category').focus(); };
    panel.querySelectorAll('[data-place]').forEach((button) => {
      button.onclick = () => {
        explored = places[Number(button.dataset.place)];
        showSource = false;
        panel.querySelectorAll('[data-place]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
        select('#study-note').textContent = explored.clue;
        updateMap();
        revealPoint(explored);
      };
    });
    if (explored) select('#study-note').textContent = explored.clue;
  } else if (!session) {
    renderStart();
  } else if (current()) {
    renderQuestion();
  } else {
    renderResults();
  }
  updateMap();
  if (focus && current()) {
    (select('#answer') ?? select('#task-title'))?.focus({preventScroll:true});
    if (current().kind === 'name') revealPoint(current().place);
  } else if (focus) {
    select('#panel-title')?.focus({preventScroll:true});
  }
}

function renderStart() {
  if (mode === 'review') {
    const questions = missed();
    const copy = questions.length
      ? `Tienes ${questions.length} ejercicios para volver a intentar. Se retiran de esta lista cuando los aciertas sin ayuda.`
      : 'Aquí aparecerán los ejercicios que falles. Empieza por Localiza o Escribe.';
    panel.innerHTML = `<h2 id="panel-title">Mis fallos</h2><p>${copy}</p>
      <button class="primary" id="start">${questions.length ? 'Repasar mis fallos' : 'Ir a Localiza'}</button>`;
    select('#start').onclick = () => questions.length ? start(shuffle(questions)) : setMode('locate');
    return;
  }
  if (mode === 'exam') {
    panel.innerHTML = `<h2 id="panel-title">Simulacro</h2>
      <p>Combina preguntas de localizar y escribir. La nota sobre 10 y las soluciones aparecen al final.</p>
      <div class="row"><button class="primary" id="short-exam">20 preguntas</button><button id="full-exam">Todo el mapa</button></div>
      <h3 class="paper-heading">Para practicar en papel</h3>
      <div class="row"><button id="print-numbered-button">Imprimir ficha numerada</button>
      <button id="print-solution-button">Imprimir solucionario</button>
      <button id="print-button">Imprimir mapa y lista</button></div>`;
    select('#short-exam').onclick = () => {
      const sample = Object.keys(categories).flatMap((key) =>
        shuffle(places.filter((place) => place.type === key)).slice(0, 4));
      start(examQuestions(sample));
    };
    select('#full-exam').onclick = () => start(examQuestions(places));
    select('#print-button').onclick = () => printWorksheet('list');
    select('#print-numbered-button').onclick = () => printWorksheet('numbered');
    select('#print-solution-button').onclick = () => printWorksheet('solution');
    return;
  }
  const locate = mode === 'locate';
  panel.innerHTML = `<h2 id="panel-title">${locate ? 'Localiza el lugar' : 'Escribe el nombre'}</h2>
    <p>${locate ? 'Lee el nombre y señala su posición sobre el mapa.' : 'Mira el lugar marcado y escribe su nombre sin opciones.'}</p>
    <label for="practice-category">Grupo de lugares</label><select id="practice-category">${options()}</select>
    <button class="primary" id="start">Empezar práctica</button>`;
  select('#practice-category').value = category;
  select('#practice-category').onchange = (event) => { category = event.target.value; };
  select('#start').onclick = () => start(shuffle(places.filter((place) => category === 'all' || place.type === category))
    .map((place) => ({place, kind: mode})));
}

function examQuestions(items) {
  return shuffle(items).map((place, index) => ({place, kind: index % 2 ? 'name' : 'locate'}));
}

function renderQuestion() {
  const question = current();
  const {place, kind} = question;
  const exam = mode === 'exam';
  const locate = kind === 'locate';
  const checked = session.checked;
  const result = session.result;
  const title = exam ? 'Simulacro' : mode === 'review' ? 'Mis fallos' : locate ? 'Localiza el lugar' : 'Escribe el nombre';
  panel.innerHTML = `<h2 id="panel-title">${title}</h2>
    <div class="question-meta">Pregunta ${session.index + 1} de ${session.questions.length} · ${categories[place.type][0]}</div>
    <div class="task"><h3 id="task-title" tabindex="-1">${locate ? 'Señala en el mapa' : '¿Qué lugar está marcado?'}</h3>
    ${locate ? `<p><strong>${place.name}</strong></p>` : `<form id="name-form">
      <label for="answer">Tu respuesta</label><input id="answer" autocomplete="off" spellcheck="false" ${checked ? 'disabled' : 'required'}>
      <button class="primary" type="submit" ${checked ? 'disabled' : ''}>${exam ? 'Guardar respuesta' : 'Comprobar'}</button></form>`}
    ${locate && !checked ? '<p class="muted question-meta">Pulsa el mapa o <button type="button" class="text-button" id="focus-map">responde con el teclado</button>.</p>' : ''}
    <span class="feedback" id="feedback" role="status"></span>
    <div class="row">
    ${exam ? '<button id="skip">Dejar en blanco</button>' : checked
      ? '<button id="next" class="primary">Continuar</button>'
      : '<button id="hint">Ver pista</button><button id="skip">Ver solución</button>'}
    </div></div>`;
  if (result) {
    showFeedback(result.message, result.style);
    if (!locate && checked) select('#answer').value = result.response;
  }
  if (!locate) {
    select('#name-form').onsubmit = (event) => {
      event.preventDefault();
      const value = select('#answer').value.trim();
      if (value) answer(accepts(place, value), value);
    };
  }
  if (select('#focus-map')) select('#focus-map').onclick = () => {
    svg.focus();
    cursor ||= {x:655,y:445};
    marker.replaceChildren();
    drawPoint(cursor.x,cursor.y,'#2c4344',7);
    revealPoint(cursor);
    showFeedback('Mueve el punto con las flechas y pulsa Intro para responder.');
  };
  if (select('#hint')) select('#hint').onclick = () => {
    session.usedHint = true;
    showFeedback(place.clue);
  };
  if (select('#skip')) select('#skip').onclick = () => answer(false, '', null, true);
  if (select('#next')) select('#next').onclick = advance;
}

function showFeedback(message, style = '') {
  const output = select('#feedback');
  output.textContent = message;
  output.className = `feedback ${style}`;
}

function answer(correct, response, point = null, skip = false) {
  const question = current();
  if (!question || session.checked) return;
  const {place, kind} = question;
  if (mode === 'exam') {
    record(question, correct);
    session.answers.push({question, correct, response, point});
    advance();
    return;
  }
  if (!correct && !skip && session.attempts === 0) {
    session.attempts++;
    record(question, false);
    updateProgress();
    showFeedback('Prueba otra vez. ' + place.clue, 'bad');
    if (kind === 'name') select('#answer').select();
    return;
  }
  if (correct && soundEnabled) {
    correctSound.currentTime = 0;
    correctSound.play().catch(() => {});
  }
  const independent = correct && session.attempts === 0 && !session.usedHint;
  record(question, independent);
  session.answers.push({question, correct: independent, response, point});
  session.checked = true;
  session.result = {
    response,
    message: correct ? (independent ? '¡Correcto!' : '¡Correcto! Volverás a practicarlo en Mis fallos.')
      : `Solución · ${place.name}. ${place.clue}`,
    style: correct ? 'good' : 'bad'
  };
  render();
  revealPoint(place);
  select('#next').focus({preventScroll:true});
}

function advance() {
  session.index++;
  session.checked = false;
  session.usedHint = false;
  session.attempts = 0;
  session.result = null;
  cursor = null;
  render(true);
}

function renderResults() {
  const exam = mode === 'exam';
  const total = session.answers.length;
  const score = session.answers.filter(({correct}) => correct).length;
  panel.innerHTML = `<h2 id="panel-title" tabindex="-1">${exam ? 'Resultado del simulacro' : 'Práctica terminada'}</h2>
    <p><strong>${score} de ${total}</strong> ${exam ? 'aciertos' : 'aciertos sin ayuda'}.</p>
    ${exam ? `<p><strong>Nota · ${(10 * score / total).toLocaleString('es-ES', {maximumFractionDigits:1})}/10</strong></p>
    <ol class="results-list" aria-label="Corrección del simulacro"></ol>` : ''}
    <div class="row"><button class="primary" id="repeat">Volver a empezar</button>
    ${exam ? '' : '<button id="go-review">Ver mis fallos</button>'}</div>`;
  if (exam) {
    const list = select('.results-list');
    session.answers.forEach(({question, correct, response, point}) => {
      const entry = document.createElement('li');
      const button = document.createElement('button');
      button.textContent = `${correct ? '✓' : '✗'} ${question.place.name}`;
      button.title = 'Mostrar solución en el mapa';
      button.onclick = () => {
        drawPlace(question.place);
        if (point && !correct) drawPoint(point.x,point.y,'#a43e26',6);
        revealPoint(question.place);
      };
      entry.append(button);
      if (!correct && question.kind === 'name') {
        const yourAnswer = document.createElement('div');
        yourAnswer.className = 'question-meta';
        yourAnswer.textContent = response ? `Tu respuesta · ${response}` : 'En blanco';
        entry.append(yourAnswer);
      }
      list.append(entry);
    });
  }
  select('#repeat').onclick = () => setMode(mode);
  if (select('#go-review')) select('#go-review').onclick = () => setMode('review');
}

function pointSegmentDistance(x, y, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const fraction = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - ax - fraction * dx, y - ay - fraction * dy);
}

function matchLocation(place, x, y) {
  if (place.line) {
    const tolerance = place.type === 'relieve' || place.type === 'costa' ? 21 : 16;
    return place.line.slice(1).some((end, i) => pointSegmentDistance(x,y,place.line[i],end) <= tolerance);
  }
  const [cx,cy,rx,ry] = place.area || [place.x,place.y,18,18];
  return ((x-cx)/rx)**2 + ((y-cy)/ry)**2 <= 1;
}

function createSvg(tag, attributes, container = marker) {
  const element = document.createElementNS('http://www.w3.org/2000/svg',tag);
  Object.entries(attributes).forEach(([name,value]) => element.setAttribute(name,value));
  container.append(element);
  return element;
}

function drawPoint(x,y,color,radius=9) {
  createSvg('circle',{cx:x,cy:y,r:radius,fill:color,stroke:'#fff','stroke-width':3});
}

function drawPlace(place, shape = true) {
  marker.replaceChildren();
  const color = categories[place.type][1];
  if (shape && place.line) {
    const points = place.line.map((point) => point.join(',')).join(' ');
    const attrs = {points,fill:'none','stroke-linecap':'round','stroke-linejoin':'round'};
    createSvg('polyline',{...attrs,stroke:'#fff','stroke-width':9});
    createSvg('polyline',{...attrs,stroke:color,'stroke-width':5});
  } else {
    drawPoint(place.x,place.y,color);
  }
}

function updateMap() {
  const question = current();
  const locate = question?.kind === 'locate' && !session.checked;
  sourceToggle.hidden = mode !== 'explore';
  sourceToggle.setAttribute('aria-pressed', String(showSource));
  sourceToggle.textContent = showSource ? 'Volver al mapa mudo' : 'Ver foto original';
  mapImage.src = showSource ? 'solucionario.png' : 'mapa.png';
  mapImage.alt = showSource ? 'Fotografía del mapa original con los nombres escritos a mano.' : 'Mapa físico mudo de Europa, con el norte arriba.';
  frame.classList.toggle('is-source', showSource);
  frame.classList.toggle('is-locating', locate);
  svg.setAttribute('tabindex', locate ? '0' : '-1');
  svg.setAttribute('aria-label', locate ? 'Mapa interactivo. Usa las flechas y pulsa Intro.' : 'Capa interactiva del mapa');
  marker.replaceChildren();
  if (mode === 'explore' && explored && !showSource) drawPlace(explored);
  if (question && (question.kind === 'name' || session.checked)) drawPlace(question.place);
  select('#map-instruction').textContent = locate ? 'Pulsa el mapa para responder. Si hace falta, deslízalo hacia los lados.'
    : mode === 'explore' ? 'Elige un nombre para verlo en el mapa.'
    : question?.kind === 'name' ? 'Fíjate en el lugar señalado.' : 'Mapa mudo de Europa física.';
}

function revealPoint(place) {
  const container = select('#map-scroll');
  if (container.scrollWidth <= container.clientWidth) return;
  const pixel = (place.x - 9) / 1307 * frame.clientWidth;
  container.scrollLeft = Math.max(0, pixel - container.clientWidth / 2);
}

svg.addEventListener('click', (event) => {
  const question = current();
  if (question?.kind !== 'locate' || session.checked) return;
  const bounds = svg.getBoundingClientRect();
  const x = 9 + 1307 * (event.clientX - bounds.left) / bounds.width;
  const y = 8 + 873 * (event.clientY - bounds.top) / bounds.height;
  cursor = {x,y};
  answer(matchLocation(question.place,x,y), '', cursor);
});

svg.addEventListener('keydown', (event) => {
  const question = current();
  if (question?.kind !== 'locate' || session.checked) return;
  const directions = {ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
  if (!directions[event.key] && event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  cursor ||= {x:655,y:445};
  if (directions[event.key]) {
    const [dx,dy] = directions[event.key];
    const step = event.shiftKey ? 35 : 9;
    cursor.x = Math.min(1311, Math.max(14,cursor.x + step * dx));
    cursor.y = Math.min(876, Math.max(13,cursor.y + step * dy));
    marker.replaceChildren();
    drawPoint(cursor.x,cursor.y,'#2c4344',7);
    revealPoint(cursor);
  } else {
    answer(matchLocation(question.place,cursor.x,cursor.y), '', {...cursor});
  }
});

// Offsets leave room between nearby labels. The line still points to the exact quiz marker.
const paperItems = [
  ['Islandia'], ['Mar de Noruega'], ['Montes Escandinavos'], ['Mar del Norte'],
  ['Támesis', 26, 28], ['Mar Báltico'], ['Océano Atlántico'], ['Península ibérica'],
  ['Cabo de San Vicente', -38, 15], ['Estrecho de Gibraltar', 24, 28],
  ['Pirineos'], ['Alpes'], ['Península itálica', 12, 39], ['Mar Adriático', 22, -18],
  ['Mar Mediterráneo'], ['Danubio'], ['Mar Negro'], ['Estrecho del Bósforo', 15, 28],
  ['Mar Caspio'], ['Montes Urales']
];

function printWorksheet(format) {
  if (format !== 'list') {
    const solution = format === 'solution';
    const marks = select('#print-markers');
    const answers = select('#numbered-answers');
    select('#numbered-title').textContent = solution ? 'Europa física · Solucionario' : 'Europa física · Ficha numerada';
    select('#numbered-instruction').textContent = solution ? 'Comprueba los veinte lugares con la lista de respuestas.'
      : 'Escribe el nombre de cada lugar junto a su número. Si un número lleva una línea, fíjate en el punto donde termina.';
    marks.replaceChildren();
    answers.replaceChildren();
    paperItems.forEach(([name, dx = 0, dy = 0], index) => {
      const place = places.find((item) => item.name === name);
      const x = place.x + dx, y = place.y + dy;
      if (dx || dy) {
        createSvg('line', {x1:place.x,y1:place.y,x2:x,y2:y,stroke:'white','stroke-width':7}, marks);
        createSvg('line', {x1:place.x,y1:place.y,x2:x,y2:y,stroke:'#172f38','stroke-width':3}, marks);
        createSvg('circle', {cx:place.x,cy:place.y,r:4,fill:'#172f38',stroke:'white','stroke-width':2}, marks);
      }
      createSvg('circle', {cx:x,cy:y,r:17,fill:'white',stroke:'#172f38','stroke-width':3}, marks);
      const number = createSvg('text', {x,y,'text-anchor':'middle','dominant-baseline':'central',
        'font-size':21,'font-weight':750,fill:'#172f38'}, marks);
      number.textContent = index + 1;
      const entry = document.createElement('li');
      if (solution) entry.textContent = name;
      else entry.append(Object.assign(document.createElement('span'), {className:'answer-line'}));
      answers.append(entry);
    });
  }
  document.body.dataset.printFormat = format;
  window.print();
}

window.addEventListener('afterprint', () => { delete document.body.dataset.printFormat; });

function updateSoundButton() {
  soundToggle.textContent = soundEnabled ? 'Sonido activado' : 'Sonido desactivado';
  soundToggle.setAttribute('aria-pressed', String(soundEnabled));
}

soundToggle.onclick = () => {
  soundEnabled = !soundEnabled;
  if (!soundEnabled) correctSound.pause();
  try { localStorage.setItem(soundKey, soundEnabled ? 'on' : 'off'); } catch {}
  updateSoundButton();
};

sourceToggle.onclick = () => { showSource = !showSource; updateMap(); };
document.querySelectorAll('[data-mode]').forEach((button) => { button.onclick = () => setMode(button.dataset.mode); });
select('#print-list').innerHTML = places.map((place,index) => `<div>${index + 1}. ${place.name}</div>`).join('');
updateSoundButton();
render();
