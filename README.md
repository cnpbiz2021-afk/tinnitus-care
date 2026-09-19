# Tinnitus Care - 한국형 이명 치료 웹 서비스

![Tinnitus Care](hero-image.jpg)

## 🎯 프로젝트 개요

**Tinnitus Care**는 과학적으로 검증된 **노치 사운드 테라피(Notched Sound Therapy)**를 기반으로 한 한국형 이명 치료 디지털 헬스케어 서비스입니다.

### ✨ 핵심 기능

- 🎵 **이명 주파수 설정**: 이명과 비슷하게 느껴지는 주파수를 직접 설정 (임상 pitch matching 검사가 아닙니다)
- 🔊 **노치 필터링**: Web Audio API `BiquadFilterNode(type="notch")`로 실제 출력 신호에서 설정 주파수 대역을 감쇠
- 🌊 **한국형 사운드스케이프**: 화이트 노이즈, 빗소리, 대나무 숲, 풍경 소리 등
- 📊 **실시간 스펙트럼**: 실제 출력 신호의 FFT 스펙트럼과 노치 위치 표시
- ✅ **노치 검증(개발자용)**: 화면에는 표시하지 않으며, 콘솔과 `verify/` 스크립트로 노치 감쇠량과 신호 경로를 확인
- ⏱️ **치료 타이머**: 일일 치료 시간 추적

---

## 🧬 기술 메커니즘: Notched Sound Therapy

### 작동 원리

1. **주파수 설정**: 사용자가 이명과 비슷하게 느껴지는 주파수(f)를 직접 설정합니다
2. **노치 필터 적용**: 선택한 사운드에서 f를 중심으로 한 대역을 감쇠 (대역폭은 코드에서 조정 가능, 기본 1/2 옥타브(−3 dB) — 개발용 기본값이며 임상 표준값이 아닙니다)
3. **측면 억제(Lateral Inhibition)**: 해당 주파수 대역의 뇌 신경 활동을 억제하여 이명 감소

### 과학적 근거

노치 사운드 테라피는 다수의 임상 연구에서 효과가 입증된 방법으로, 장기간 사용 시 이명 크기와 불편함을 유의미하게 감소시킵니다.

---

## 🛠️ 기술 스택

| 구분 | 기술 | 설명 |
|------|------|------|
| **Frontend** | HTML5, CSS3, JavaScript (ES6+) | 순수 웹 기술로 빠른 로딩과 호환성 확보 |
| **Audio Processing** | Web Audio API | 브라우저 기반 실시간 오디오 처리 |
| **Design** | Custom CSS with Design System | 브랜드 컬러 기반 프리미엄 디자인 |
| **Typography** | Noto Sans KR, Inter | 한글 가독성 최적화 |

---

## 📁 프로젝트 구조

```
tinnitus-care/
├── index.html          # 메인 HTML 구조
├── styles.css          # 디자인 시스템 및 스타일
├── audio-engine.js     # Web Audio API 기반 오디오 엔진
├── app.js             # UI 인터랙션 및 비주얼라이저
├── hero-image.jpg     # 브랜드 히어로 이미지
└── README.md          # 프로젝트 문서
```

---

## 🚀 빠른 시작

### 1. 파일 열기

프로젝트 폴더에서 `index.html`을 더블클릭하거나 브라우저로 드래그하세요.

```bash
# 또는 명령어로 실행
start index.html  # Windows
open index.html   # macOS
xdg-open index.html  # Linux
```

### 2. 사용 방법

#### STEP 1: 이명 주파수 설정
1. 조용한 환경에서 헤드폰을 착용하세요
2. 프리셋 버튼(삐-, 웅-, 맴맴, 쉿-)을 클릭하거나 슬라이더를 조절하세요
3. "테스트 톤 재생" 버튼으로 해당 주파수를 들어보세요

#### STEP 2: 사운드 선택
- 화이트 노이즈: 균일한 주파수 (기본)
- 빗소리: 자연의 소리
- 숲속 바람: 대나무 숲의 평온함
- 풍경 소리: 사찰의 고요함
- 밤 벌레 소리: 시골의 밤
- 파도 소리: 해변의 평화

#### STEP 3: 치료 시작
1. 볼륨을 편안한 수준으로 조절하세요
2. "치료 시작" 버튼을 클릭하세요
3. 스펙트럼 화면에서 실제 출력의 노치(딥)를 확인하세요
4. 하루 30분 이상, 최소 3개월간 꾸준히 진행하세요

---

## 🎨 디자인 시스템

### 브랜드 컬러

```css
--primary-blue: #1E4D8B;        /* 메인 브랜드 컬러 */
--primary-blue-light: #5B9BD5;  /* 밝은 블루 */
--primary-blue-dark: #0D2847;   /* 다크 블루 */
--accent-blue: #4A90E2;         /* 액센트 컬러 */
```

### 디자인 원칙

1. **시각적 안정감**: 파스텔 블루/그린 계열로 청각 스트레스 완화
2. **직관적 UI**: 큰 슬라이더와 프리셋 버튼 병행
3. **프리미엄 느낌**: 그라디언트, 섀도우, 부드러운 애니메이션
4. **한국형 UX**: 한글 타이포그래피와 친숙한 사운드스케이프

---

## 🔬 핵심 코드 설명

### 1. 실제 오디오 신호 경로 (audio-engine.js)

```text
Voice(소리 1개) = BufferSource → Shaping(Biquad) → CharacterGain → VoiceGain
                                                                   │
SoundBus ──(측정용 탭)→ PreNotchAnalyser → SilentSink              │
   ▼ ◄─────────────────────────────────────────────────────────────┘
NotchFilter[0..N-1]   (BiquadFilterNode type="notch", 직렬 연결)
   ▼
TherapyGain → Analyser → MasterGain → Output
```

- 노치 필터·게인·아날라이저는 **한 번만 만들고 재사용**합니다. 주파수 변경 시 `frequency` / `Q` AudioParam만 `setTargetAtTime()`으로 부드럽게 이동합니다.
- 사운드 전환은 Voice만 새로 만들고 이전 Voice는 페이드아웃 후 stop/disconnect 됩니다 (연결·소리 중복 없음).
- `AudioNode`에는 표준 `connected` 속성이 없으므로, 모든 연결은 엔진 내부 레지스트리에 기록되고 `verifySignalChain()`으로 검증합니다.

### 2. 노치 파라미터 (코드에서 분리)

```javascript
audioEngine.setFrequency(6000);          // tinnitusFrequency = 노치 중심
audioEngine.setNotchBandwidth(0.5);      // notchBandwidth (−3 dB, octave)
audioEngine.setNotchQ(2.5);              // notchQ (등가 단일 필터 Q)
audioEngine.notchStages;                 // 직렬 노치 단 수 (생성자 옵션, 기본 2)
```

이 값들은 실제로 소리가 들리고 측정되도록 잡은 **엔지니어링 기본값**입니다. 임상적으로 검증된 치료값으로 표시하지 않습니다.

### 3. 환경음의 스펙트럼 (TINNITUS_SOUND_PROFILES)

기존에는 파도(로우패스 350Hz), 풍경(로우패스 900Hz) 등 강한 필터 때문에 6000Hz에 에너지가 거의 없어(측정: 파도 −78 dB, 풍경 −67 dB) 노치가 무의미했습니다. 현재는 하드 필터 대신 shelf/peaking 필터를 쓰고, 파도 버퍼에는 스웰에 동기화된 광대역 서핑 히스를 넣어 250~12000Hz 전 대역에 에너지가 있도록 했습니다.

---

## ✅ 노치 검증 방법

1. **콘솔에서** (재생 중): `audioEngine.measureLive()` — 노치 전/후 레벨과 감쇠량(dB)
2. **콘솔에서** (오프라인 렌더): `await TinnitusAudioEngine.runSelfTest({ sound: 'whitenoise', frequency: 6000 })`
3. **신호 경로**: `audioEngine.verifySignalChain()`
4. **자동 테스트** (`verify/` 폴더, Node 18+):

```bash
cd verify && npm install
node tests.js        # Test 1~7 (오프라인 렌더 + FFT)
node e2e.js          # 실제 Chromium에서 클릭/재생/라이브 측정 (선택)
```

`verify/`는 개발용이므로 배포 시 제외해도 됩니다.

---

## 📊 주요 파라미터

| 파라미터 | 값 | 설명 |
|---------|-----|------|
| 주파수 범위 | 250Hz ~ 12000Hz | 슬라이더 범위 (엔진 내부 클램프는 20Hz ~ 나이퀴스트의 90%) |
| 노치 대역폭 | 1/2 옥타브 (−3 dB) | 개발용 기본값, 1/4·1/2·1 옥타브 선택 가능 |
| 노치 단 수 | 2 | 직렬 biquad notch 수 (깊이·스커트) |
| 측정된 노치 감쇠 | 약 30 dB | 중심 주파수 부근, 250Hz에서는 약 24 dB |
| 권장 볼륨 | 30-50% | 편안한 청취 수준 |
| 권장 시간 | 30분/일 | 최소 치료 시간 |

---

## ⚠️ 의료 면책 조항

본 서비스는 **의료 기기가 아니며**, 의료 진단을 대체하지 않습니다.

- 이명 증상이 심하거나 지속되는 경우 반드시 전문의와 상담하세요
- 본 서비스는 이명 관리를 위한 **보조 도구**로 사용하시기 바랍니다
- 청력 손실이나 귀 질환이 있는 경우 사용 전 의사와 상담하세요

---

## 🌟 향후 개발 계획

### Phase 2: 데이터 트래킹
- [ ] 치료 기록 저장 (LocalStorage)
- [ ] 일일/주간/월간 리포트
- [ ] 증상 개선 추적 그래프

### Phase 3: 개인화
- [ ] 카카오/네이버 간편 로그인 (Supabase)
- [ ] 개인별 맞춤 치료 프로그램
- [ ] 치료 알림 및 리마인더

### Phase 4: 고급 기능
- [ ] 음악 파일 업로드 및 노치 필터 적용
- [ ] 양이 독립 주파수 설정 (좌/우 이명 다를 경우)
- [ ] 전문가 상담 연결 기능

---

## 🤝 기여 및 피드백

이 프로젝트는 이명으로 고통받는 분들을 위한 오픈소스 프로젝트입니다.

- 버그 리포트: Issues 탭에서 제보해주세요
- 기능 제안: 새로운 아이디어를 공유해주세요
- 코드 기여: Pull Request를 환영합니다

---

## 📄 라이선스

MIT License - 자유롭게 사용, 수정, 배포 가능합니다.

---

## 📞 문의

프로젝트 관련 문의사항이 있으시면 Issues를 통해 연락주세요.

---

**Tinnitus Care** - 친근한 닥터, 늘 곁에 있어요 💙
# tinnitus-care
