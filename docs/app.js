const CONFIG = {
  width: 720,
  height: 720,
  timeLimitSeconds: 180,
  inactivityMs: 60000,
  storageKey: 'vmu70_mobile_best_remaining',
};

const TARGET_CHARS = ['V', 'M', 'U', '70'];
const TRAP_CHARS = 'ABCDEFGHJKLNPQRTWXYZ'.split('');

const dom = {
  canvas: document.getElementById('gameCanvas'),
  heroNote: document.getElementById('heroNote'),
  timerValue: document.getElementById('timerValue'),
  shotsValue: document.getElementById('shotsValue'),
  bestValue: document.getElementById('bestValue'),
  missionStrip: document.getElementById('missionStrip'),
  actionButton: document.getElementById('actionButton'),
  resetButton: document.getElementById('resetButton'),
  fastRetractButton: document.getElementById('fastRetractButton'),
};

const ctx = dom.canvas.getContext('2d');

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const randomBetween = (min, max) => min + Math.random() * (max - min);

function formatTime(seconds) {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = String(Math.floor(safe / 60)).padStart(2, '0');
  const secs = String(safe % 60).padStart(2, '0');
  return `${mins}:${secs}`;
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

class Entity {
  constructor(kind, x, y, vx, radius, char = '') {
    this.kind = kind;
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.radius = radius;
    this.char = char;
    this.active = true;
    this.respawnTimer = 0;
  }
}

class Particle {
  constructor(x, y, vx, vy, life, size, color) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.life = life;
    this.size = size;
    this.color = color;
  }
}

class GameEngine {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.baseX = width / 2;
    this.baseY = height - 64;
    this.sceneReady = false;
    this.fastRetract = false;
    this.resetRuntime();
  }

  resetRuntime() {
    this.targets = [];
    this.traps = [];
    this.mines = [];
    this.particles = [];
    this.collected = Object.fromEntries(TARGET_CHARS.map((char) => [char, false]));
    this.shots = 0;
    this.penalties = 0;
    this.penaltyFlash = 0;
    this.stunTimer = 0;
    this.isRunning = false;
    this.anchorAngle = -Math.PI / 2;
    this.anchorDir = 1;
    this.anchorLength = 0;
    this.anchorState = 'idle';
    this.startTimeMs = performance.now();
    this.lastInputTimeMs = this.startTimeMs;
  }

  start() {
    this.resetRuntime();
    this.sceneReady = true;
    this.isRunning = true;
    this.mines = Array.from({ length: 4 }, () => this.spawnEntity('mine'));
    this.targets = TARGET_CHARS.map((char) => this.spawnEntity('special', char));
    this.traps = Array.from({ length: 10 }, (_, index) => this.spawnEntity('trap', TRAP_CHARS[index % TRAP_CHARS.length]));
  }

  setFastRetract(enabled) {
    this.fastRetract = enabled;
    if (enabled) {
      this.lastInputTimeMs = performance.now();
    }
  }

  fire() {
    if (!this.isRunning || this.anchorState !== 'idle' || this.stunTimer > 0) {
      return;
    }

    this.anchorState = 'extending';
    this.anchorLength = 0;
    this.shots += 1;
    this.lastInputTimeMs = performance.now();
  }

  getElapsedMs(now = performance.now()) {
    return now - this.startTimeMs + this.penalties * 5000;
  }

  getTimeLeft(now = performance.now()) {
    const raw = CONFIG.timeLimitSeconds - this.getElapsedMs(now) / 1000;
    return Math.max(0, Math.ceil(raw));
  }

  update(dt, now) {
    if (!this.isRunning) {
      return null;
    }

    if (now - this.lastInputTimeMs >= CONFIG.inactivityMs) {
      this.isRunning = false;
      return 'inactive';
    }

    if (this.getTimeLeft(now) <= 0) {
      this.isRunning = false;
      return 'gameover';
    }

    if (this.penaltyFlash > 0) {
      this.penaltyFlash = Math.max(0, this.penaltyFlash - dt * 2.4);
    }

    if (this.stunTimer > 0) {
      this.stunTimer = Math.max(0, this.stunTimer - dt);
    } else if (this.anchorState === 'idle') {
      this.updateIdleSweep(dt);
    } else if (this.anchorState === 'extending') {
      this.updateAnchorExtension(dt);
    } else if (this.anchorState === 'retracting') {
      this.updateAnchorRetraction(dt);
    }

    this.updateEntities(dt);
    this.updateParticles(dt);

    if (TARGET_CHARS.every((char) => this.collected[char])) {
      this.isRunning = false;
      return 'win';
    }

    return null;
  }

  updateIdleSweep(dt) {
    const sweepSpeed = 1.25;
    const minAngle = -Math.PI + 0.25;
    const maxAngle = -0.25;
    this.anchorAngle += sweepSpeed * this.anchorDir * dt;

    if (this.anchorAngle >= maxAngle) {
      this.anchorAngle = maxAngle;
      this.anchorDir = -1;
    } else if (this.anchorAngle <= minAngle) {
      this.anchorAngle = minAngle;
      this.anchorDir = 1;
    }
  }

  updateAnchorExtension(dt) {
    this.anchorLength += 720 * dt;
    const tip = this.anchorTip();

    if (tip.x <= 0 || tip.x >= this.width || tip.y <= 0) {
      this.anchorState = 'retracting';
      return;
    }

    for (const mine of this.mines) {
      if (mine.active && this.hitsEntity(tip.x, tip.y, mine)) {
        mine.active = false;
        mine.respawnTimer = 2.4;
        this.anchorState = 'retracting';
        this.stunTimer = 1.1;
        this.emitParticles(tip.x, tip.y, '#f45c6c', 28);
        return;
      }
    }

    for (const target of this.targets) {
      if (target.active && this.hitsEntity(tip.x, tip.y, target)) {
        target.active = false;
        this.anchorState = 'retracting';
        this.collected[target.char] = true;
        this.emitParticles(target.x, target.y, '#ffd166', 64);
        return;
      }
    }

    for (const trap of this.traps) {
      if (trap.active && this.hitsEntity(tip.x, tip.y, trap)) {
        trap.active = false;
        trap.respawnTimer = 1.4;
        this.anchorState = 'retracting';
        this.penalties += 1;
        this.penaltyFlash = 1;
        this.emitParticles(trap.x, trap.y, '#ffffff', 18);
        return;
      }
    }

    if (this.anchorLength >= 860) {
      this.anchorState = 'retracting';
    }
  }

  updateAnchorRetraction(dt) {
    let speed = 820 * dt;
    if (this.fastRetract) {
      speed *= 1.9;
    }

    this.anchorLength -= speed;
    if (this.anchorLength <= 0) {
      this.anchorLength = 0;
      this.anchorState = 'idle';
    }
  }

  updateEntities(dt) {
    for (const mine of this.mines) {
      this.updateEntityMotion(mine, dt, 52, this.width - 52);
    }

    for (const trap of this.traps) {
      this.updateEntityMotion(trap, dt, 36, this.width - 36);
    }

    for (const target of this.targets) {
      if (target.active) {
        this.updateEntityMotion(target, dt, 40, this.width - 40);
      }
    }
  }

  updateEntityMotion(entity, dt, minX, maxX) {
    if (!entity.active) {
      if (entity.respawnTimer > 0) {
        entity.respawnTimer -= dt;
      }
      if (entity.respawnTimer <= 0 && entity.kind !== 'special') {
        const replacement = this.spawnEntity(entity.kind, entity.char);
        entity.x = replacement.x;
        entity.y = replacement.y;
        entity.vx = replacement.vx;
        entity.radius = replacement.radius;
        entity.active = true;
        entity.respawnTimer = 0;
      }
      return;
    }

    entity.x += entity.vx * dt;
    if (entity.x <= minX || entity.x >= maxX) {
      entity.x = clamp(entity.x, minX, maxX);
      entity.vx *= -1;
    }
  }

  updateParticles(dt) {
    const nextParticles = [];
    for (const particle of this.particles) {
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vy += 460 * dt;
      particle.life -= dt * 1.2;
      if (particle.life > 0) {
        nextParticles.push(particle);
      }
    }
    this.particles = nextParticles;
  }

  spawnEntity(kind, char = '') {
    const radiusMap = { mine: 22, special: 28, trap: 20 };
    const speed = (Math.random() < 0.5 ? -1 : 1) * randomBetween(70, 140);
    return new Entity(
      kind,
      randomBetween(70, this.width - 70),
      randomBetween(90, this.height * 0.58),
      speed,
      radiusMap[kind],
      char
    );
  }

  anchorTip() {
    return {
      x: this.baseX + Math.cos(this.anchorAngle) * this.anchorLength,
      y: this.baseY + Math.sin(this.anchorAngle) * this.anchorLength,
    };
  }

  hitsEntity(tipX, tipY, entity) {
    return Math.hypot(tipX - entity.x, tipY - entity.y) <= entity.radius + 14;
  }

  emitParticles(x, y, color, count) {
    for (let i = 0; i < count; i += 1) {
      this.particles.push(
        new Particle(
          x,
          y,
          randomBetween(-150, 150),
          randomBetween(-150, 150),
          randomBetween(0.4, 1),
          randomBetween(2, 6),
          color
        )
      );
    }
  }

  draw(context, assets) {
    context.clearRect(0, 0, this.width, this.height);

    const gradient = context.createLinearGradient(0, 0, 0, this.height);
    gradient.addColorStop(0, '#0b466b');
    gradient.addColorStop(0.45, '#0d7aac');
    gradient.addColorStop(1, '#061a29');
    context.fillStyle = gradient;
    context.fillRect(0, 0, this.width, this.height);

    if (assets.crest) {
      context.save();
      context.globalAlpha = 0.13;
      const crestSize = 250;
      context.drawImage(assets.crest, this.width / 2 - crestSize / 2, this.height / 2 - crestSize / 2, crestSize, crestSize);
      context.restore();
    }

    context.save();
    for (let offset = 0; offset < 5; offset += 1) {
      context.strokeStyle = `rgba(181, 228, 255, ${0.16 - offset * 0.02})`;
      context.lineWidth = 3;
      context.beginPath();
      context.ellipse(this.width / 2, this.height * 0.82 + offset * 24, this.width * 0.62, 80, 0, Math.PI, Math.PI * 2);
      context.stroke();
    }
    context.restore();

    context.beginPath();
    context.setLineDash([8, 12]);
    context.strokeStyle = 'rgba(22, 48, 71, 0.9)';
    context.lineWidth = 2;
    context.ellipse(this.width / 2, this.height * 0.39, this.width / 2 - 46, this.height * 0.32, 0, 0, Math.PI * 2);
    context.stroke();
    context.setLineDash([]);

    if (this.penaltyFlash > 0) {
      context.save();
      context.globalAlpha = this.penaltyFlash * 0.26;
      context.fillStyle = '#ef4444';
      context.fillRect(0, 0, this.width, this.height);
      context.restore();
    }

    for (const mine of this.mines) {
      if (!mine.active) {
        continue;
      }
      this.drawMine(context, mine);
    }

    for (const target of this.targets) {
      if (!target.active) {
        continue;
      }
      this.drawLetter(context, target.x, target.y, target.char, target.radius, '#ffd166', '#ffe39a');
    }

    for (const trap of this.traps) {
      if (!trap.active) {
        continue;
      }
      this.drawLetter(context, trap.x, trap.y, trap.char, trap.radius, '#ffffff');
    }

    if (this.anchorState === 'idle' && this.stunTimer <= 0) {
      const previewX = this.baseX + Math.cos(this.anchorAngle) * 820;
      const previewY = this.baseY + Math.sin(this.anchorAngle) * 820;
      context.save();
      context.strokeStyle = 'rgba(138, 196, 245, 0.52)';
      context.setLineDash([10, 10]);
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(this.baseX, this.baseY);
      context.lineTo(previewX, previewY);
      context.stroke();
      context.restore();
    }

    if (this.anchorState !== 'idle') {
      const tip = this.anchorTip();
      context.save();
      context.strokeStyle = this.anchorState === 'extending' ? '#d4e4f2' : '#9ab7ce';
      context.lineWidth = this.fastRetract ? 4 : 3;
      context.beginPath();
      context.moveTo(this.baseX, this.baseY);
      context.lineTo(tip.x, tip.y);
      context.stroke();
      context.restore();
      this.drawAnchorHead(context, tip.x, tip.y, this.anchorAngle);
    }

    this.drawOfficer(context);

    for (const particle of this.particles) {
      context.save();
      context.globalAlpha = particle.life;
      context.fillStyle = particle.color;
      context.beginPath();
      context.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }
  }

  drawMine(context, mine) {
    context.save();
    context.fillStyle = '#182636';
    context.strokeStyle = '#f45c6c';
    context.lineWidth = 3;
    context.beginPath();
    context.arc(mine.x, mine.y, mine.radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();

    for (let angle = 0; angle < 360; angle += 45) {
      const rad = (angle * Math.PI) / 180;
      const innerX = mine.x + Math.cos(rad) * (mine.radius - 2);
      const innerY = mine.y + Math.sin(rad) * (mine.radius - 2);
      const outerX = mine.x + Math.cos(rad) * (mine.radius + 8);
      const outerY = mine.y + Math.sin(rad) * (mine.radius + 8);
      context.beginPath();
      context.moveTo(innerX, innerY);
      context.lineTo(outerX, outerY);
      context.stroke();
    }
    context.restore();
  }

  drawLetter(context, x, y, text, radius, fill, glow = null) {
    const fontSize = Math.max(18, Math.floor(radius * 1.45));
    context.save();
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    if (glow) {
      context.fillStyle = glow;
      context.font = `900 ${fontSize + 8}px Bahnschrift, Trebuchet MS, sans-serif`;
      context.fillText(text, x, y);
    }
    context.fillStyle = fill;
    context.font = `900 ${fontSize}px Bahnschrift, Trebuchet MS, sans-serif`;
    context.fillText(text, x, y);
    context.restore();
  }

  drawAnchorHead(context, x, y, angle) {
    const points = [
      [0, -18],
      [0, 18],
      [-12, 8],
      [0, 24],
      [12, 8],
    ];
    const rotAngle = angle + Math.PI / 2;
    const rotated = points.map(([px, py]) => ({
      x: x + px * Math.cos(rotAngle) - py * Math.sin(rotAngle),
      y: y + px * Math.sin(rotAngle) + py * Math.cos(rotAngle),
    }));

    context.save();
    context.strokeStyle = '#ffffff';
    context.lineWidth = 4;
    context.beginPath();
    context.moveTo(rotated[0].x, rotated[0].y);
    context.lineTo(rotated[1].x, rotated[1].y);
    context.lineTo(rotated[2].x, rotated[2].y);
    context.moveTo(rotated[1].x, rotated[1].y);
    context.lineTo(rotated[3].x, rotated[3].y);
    context.moveTo(rotated[1].x, rotated[1].y);
    context.lineTo(rotated[4].x, rotated[4].y);
    context.stroke();
    context.beginPath();
    context.arc(x, y, 12, Math.PI * 1.1, Math.PI * 1.9);
    context.stroke();
    context.restore();
  }

  drawOfficer(context) {
    const jitterX = this.stunTimer > 0 ? randomBetween(-6, 6) : 0;
    const jitterY = this.stunTimer > 0 ? randomBetween(-6, 6) : 0;
    const x = this.baseX + jitterX;
    const y = this.baseY + jitterY;

    context.save();
    context.fillStyle = this.stunTimer > 0 ? '#60758b' : '#294b75';
    context.fillRect(x - 30, y - 10, 60, 58);
    context.fillStyle = '#f3d2ac';
    context.fillRect(x - 18, y - 34, 36, 26);
    context.fillStyle = '#f5f8ff';
    context.fillRect(x - 24, y - 50, 48, 16);
    context.fillStyle = '#09131d';
    context.fillRect(x - 24, y - 34, 48, 4);

    if (this.stunTimer > 0) {
      context.fillStyle = '#08131e';
      context.font = '900 14px Bahnschrift, Trebuchet MS, sans-serif';
      context.fillText('X', x - 8, y - 18);
      context.fillText('X', x + 8, y - 18);
    } else {
      context.beginPath();
      context.fillStyle = '#08131e';
      context.arc(x - 7, y - 20, 3, 0, Math.PI * 2);
      context.arc(x + 7, y - 20, 3, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }
}

class MobileWebApp {
  constructor() {
    this.assets = { mainLogo: null, crest: null };
    this.engine = new GameEngine(CONFIG.width, CONFIG.height);
    this.state = 'start';
    this.notice = 'Nhấn Space để bắt đầu...';
    this.lastResult = { shots: 0, timeLeft: 0 };
    this.bestRemaining = this.loadBestRecord();
    this.penaltyBannerUntil = 0;
    this.lastFrame = performance.now();

    this.buildMissionChips();
    this.installEvents();
    this.resizeCanvas();
    this.loadAssets();
    this.refreshUI();
    requestAnimationFrame((timestamp) => this.loop(timestamp));
  }

  async loadAssets() {
    const [mainLogo, crest] = await Promise.all([
      loadImage('./logo-70-main.png'),
      loadImage('./Logo-Truong-Dai-Hoc-Hang-Hai.webp'),
    ]);
    this.assets.mainLogo = mainLogo;
    this.assets.crest = crest;
  }

  loadBestRecord() {
    try {
      return Number.parseInt(localStorage.getItem(CONFIG.storageKey) || '0', 10) || 0;
    } catch (error) {
      return 0;
    }
  }

  saveBestRecord() {
    try {
      localStorage.setItem(CONFIG.storageKey, String(this.bestRemaining));
    } catch (error) {
      // Ignore storage failures in restricted browsers.
    }
  }

  buildMissionChips() {
    dom.missionStrip.innerHTML = '';
    this.missionChips = {};
    TARGET_CHARS.forEach((char) => {
      const chip = document.createElement('div');
      chip.className = 'mission-chip';
      chip.textContent = char;
      dom.missionStrip.appendChild(chip);
      this.missionChips[char] = chip;
    });
  }

  installEvents() {
    window.addEventListener('resize', () => this.resizeCanvas());

    dom.canvas.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      if (this.state === 'playing') {
        this.engine.fire();
      } else {
        this.startGame();
      }
    });

    dom.actionButton.addEventListener('click', () => {
      if (this.state === 'playing') {
        this.resetToStart();
      } else {
        this.startGame();
      }
    });

    dom.resetButton.addEventListener('click', () => {
      this.resetToStart();
    });

    const enableFastRetract = (event) => {
      event.preventDefault();
      this.engine.setFastRetract(true);
    };

    const disableFastRetract = (event) => {
      event.preventDefault();
      this.engine.setFastRetract(false);
    };

    dom.fastRetractButton.addEventListener('pointerdown', enableFastRetract);
    dom.fastRetractButton.addEventListener('pointerup', disableFastRetract);
    dom.fastRetractButton.addEventListener('pointercancel', disableFastRetract);
    dom.fastRetractButton.addEventListener('pointerleave', disableFastRetract);

    window.addEventListener('keydown', (event) => {
      if (event.code === 'Space') {
        event.preventDefault();
        if (this.state === 'playing') {
          this.engine.fire();
        } else {
          this.startGame();
        }
      }

      if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
        this.engine.setFastRetract(true);
      }
    });

    window.addEventListener('keyup', (event) => {
      if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
        this.engine.setFastRetract(false);
      }
    });
  }

  resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    dom.canvas.width = CONFIG.width * dpr;
    dom.canvas.height = CONFIG.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  startGame() {
    this.engine.start();
    this.state = 'playing';
    this.notice = 'Chạm màn hình để tung neo. Giữ Shift hoặc nút Thu Nhanh khi neo rút về.';
    this.refreshUI();
  }

  resetToStart() {
    this.engine = new GameEngine(CONFIG.width, CONFIG.height);
    this.state = 'start';
    this.notice = 'Nhấn Space để bắt đầu...';
    this.refreshUI();
  }

  loop(timestamp) {
    const dt = Math.min((timestamp - this.lastFrame) / 1000, 0.033);
    this.lastFrame = timestamp;

    if (this.state === 'playing') {
      const event = this.engine.update(dt, timestamp);

      if (event === 'win') {
        this.lastResult = { shots: this.engine.shots, timeLeft: this.engine.getTimeLeft(timestamp) };
        this.notice = 'Chiến thắng. Tổ hợp V - M - U - 70 đã hoàn tất.';
        if (this.lastResult.timeLeft > this.bestRemaining) {
          this.bestRemaining = this.lastResult.timeLeft;
          this.saveBestRecord();
          this.notice = 'Chiến thắng. Bạn vừa tạo kỷ lục mới trên trình duyệt này.';
        }
        this.state = 'win';
      } else if (event === 'gameover') {
        this.lastResult = { shots: this.engine.shots, timeLeft: 0 };
        this.notice = 'Hết giờ. Thử lại để tối ưu đường quăng neo.';
        this.state = 'gameover';
      } else if (event === 'inactive') {
        this.notice = 'Trò chơi quay về màn chờ vì không có thao tác trong 60 giây.';
        this.state = 'start';
      }

      if (this.engine.penaltyFlash > 0) {
        this.penaltyBannerUntil = timestamp + 350;
      }
    }

    this.render(timestamp);
    this.refreshUI(timestamp);
    requestAnimationFrame((nextTimestamp) => this.loop(nextTimestamp));
  }

  refreshUI(timestamp = performance.now()) {
    let timeLeft = CONFIG.timeLimitSeconds;
    let shots = 0;

    if (this.state === 'playing') {
      timeLeft = this.engine.getTimeLeft(timestamp);
      shots = this.engine.shots;
    } else if (this.state === 'win' || this.state === 'gameover') {
      timeLeft = this.lastResult.timeLeft;
      shots = this.lastResult.shots;
    }

    dom.heroNote.textContent = this.notice;
    dom.timerValue.textContent = formatTime(timeLeft);
    dom.shotsValue.textContent = String(shots);
    dom.bestValue.textContent = formatTime(this.bestRemaining);

    TARGET_CHARS.forEach((char) => {
      this.missionChips[char].classList.toggle('active', Boolean(this.engine.collected[char]));
    });

    dom.fastRetractButton.classList.toggle(
      'hidden',
      !(this.state === 'playing' && this.engine.anchorState === 'retracting')
    );

    if (this.state === 'playing') {
      dom.actionButton.textContent = 'Làm Mới Ván Chơi';
      dom.actionButton.style.background = 'linear-gradient(135deg, #f45c6c, #ff8996)';
      dom.actionButton.style.color = '#ffffff';
      dom.resetButton.textContent = 'Về Màn Hình Chờ';
    } else if (this.state === 'win') {
      dom.actionButton.textContent = 'Chơi Lại';
      dom.actionButton.style.background = 'linear-gradient(135deg, #ffd166, #ffe6a2)';
      dom.actionButton.style.color = '#4a2b00';
      dom.resetButton.textContent = 'Về Màn Hình Chờ';
    } else if (this.state === 'gameover') {
      dom.actionButton.textContent = 'Thử Lại';
      dom.actionButton.style.background = 'linear-gradient(135deg, #f45c6c, #ff8996)';
      dom.actionButton.style.color = '#ffffff';
      dom.resetButton.textContent = 'Về Màn Hình Chờ';
    } else {
      dom.actionButton.textContent = 'Bắt Đầu Nhiệm Vụ';
      dom.actionButton.style.background = 'linear-gradient(135deg, #62c7ff, #8fe1ff)';
      dom.actionButton.style.color = '#052032';
      dom.resetButton.textContent = 'Về Màn Hình Chờ';
    }
  }

  render(timestamp) {
    this.engine.draw(ctx, this.assets);

    if (timestamp < this.penaltyBannerUntil) {
      ctx.save();
      ctx.fillStyle = 'rgba(149, 28, 28, 0.84)';
      ctx.fillRect(0, 0, CONFIG.width, 74);
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 22px Bahnschrift, Trebuchet MS, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('BẪY CHỮ TRẮNG -5 GIÂY', CONFIG.width / 2, 44);
      ctx.restore();
    }

    if (this.state === 'start') {
      this.drawOverlay('NHIỆM VỤ SĨ QUAN', 'Nhấn Space để bắt đầu...\nQuăng neo để thu thập V - M - U - 70 và né bẫy chữ trắng.', '#62c7ff');
    } else if (this.state === 'win') {
      this.drawOverlay('CHIẾN THẮNG', `Hoàn thành với ${formatTime(this.lastResult.timeLeft)} còn lại\nvà ${this.lastResult.shots} lượt quăng.`, '#ffd166');
    } else if (this.state === 'gameover') {
      this.drawOverlay('HẾT GIỜ', 'Tổ hợp kỷ niệm vẫn chưa đầy đủ.\nNhấn Chơi Lại để vào một lượt mới.', '#f45c6c');
    }
  }

  drawOverlay(title, subtitle, accent) {
    ctx.save();
    ctx.fillStyle = 'rgba(3, 17, 27, 0.72)';
    ctx.fillRect(0, 0, CONFIG.width, CONFIG.height);

    if (this.assets.mainLogo) {
      const logoSize = 220;
      ctx.drawImage(this.assets.mainLogo, CONFIG.width / 2 - logoSize / 2, 96, logoSize, logoSize);
    }

    ctx.textAlign = 'center';
    ctx.fillStyle = accent;
    ctx.font = '900 30px Palatino Linotype, Book Antiqua, serif';
    ctx.fillText(title, CONFIG.width / 2, 356);

    const lines = subtitle.split('\n');
    ctx.fillStyle = '#eef8ff';
    ctx.font = '700 18px Bahnschrift, Trebuchet MS, sans-serif';
    lines.forEach((line, index) => {
      ctx.fillText(line, CONFIG.width / 2, 414 + index * 30);
    });

    ctx.fillStyle = '#c9def0';
    ctx.font = '700 12px Bahnschrift, Trebuchet MS, sans-serif';
    ctx.fillText('COPYRIGHT BY PHAM TRUNG MINH - KHOA CNTT', CONFIG.width / 2, CONFIG.height - 34);
    ctx.restore();
  }
}

new MobileWebApp();
