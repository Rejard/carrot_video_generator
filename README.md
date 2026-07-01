# 🥕 Carrot Video Generator (당근 비디오 생성기)

이 프로젝트는 Google Gemini AI와 FFmpeg를 사용하여 텍스트와 이미지를 기반으로 멋진 비디오를 자동으로 생성하는 도구입니다. 윈도우 환경에서 안티그래비티 2.0(Antigravity 2.0)을 사용하는 사용자를 위해 최적화된 설치 및 실행 가이드를 제공합니다.

---

## 🛠 1. 필수 프로그램 설치 (Prerequisites)

비디오 생성기를 실행하기 위해 컴퓨터에 다음 프로그램들이 설치되어 있어야 합니다.

### 1) Node.js 설치
- **터미널 설치법 (권장)**: 터미널(PowerShell)에서 아래 명령어를 입력하여 설치하세요.
  ```powershell
  # winget 사용 시 (윈도우 기본)
  winget install OpenJS.NodeJS.LTS

  # 또는 Chocolatey 사용 시
  choco install nodejs-lts
  ```
- **확인**: 터미널에서 `node -v`를 입력했을 때 버전 번호(예: v20.x.x)가 나오면 성공입니다.

### 2) FFmpeg 설치 (가장 중요!)
이 프로젝트는 비디오 편집을 위해 FFmpeg가 반드시 필요합니다.
- **터미널 설치법 (권장)**: 터미널에서 아래 명령어를 입력하여 설치할 수 있습니다 (Chocolatey 사용 시).
  ```powershell
  choco install ffmpeg
  ```
- **수동 설치**: [ffmpeg.org](https://ffmpeg.org/download.html)에서 윈도우용 바이너리를 다운로드하고, 환경 변수(Path)에 등록해야 합니다.
  > [!TIP]
  > 안티그래비티 2.0 사용자라면 아래 Vibe 지시어를 사용하는 것이 훨씬 편합니다!

---

## 🚀 2. 설치 방법 (Installation)

### 방법 A: 터미널 명령어 사용 (전문가용)
1. **소스 코드 내려받기**:
   ```bash
   git clone https://github.com/Rejard/carrot_video_generator.git
   cd carrot_video_generator
   ```
2. **필요한 패키지 설치**:
   ```bash
   npm install
   ```
3. **환경 설정**:
   - 프로젝트 폴더에 `.env` 파일을 만들고 아래 내용을 입력하세요.
   ```env
   GEMINI_API_KEY=your_api_key_here
   ```

### 방법 B: 안티그래비티 2.0 Vibe 지시어 (초보자 권장) ✨
안티그래비티 2.0의 채팅창에 아래와 같이 말하면 AI가 알아서 설치해 줍니다.

- **설치 요청**:
  > "이 프로젝트 실행할 수 있게 필요한 프로그램들이랑 패키지 전부 설치해줘. FFmpeg도 확인해보고 없으면 설치해줘."
- **환경 설정**:
  > "내 Gemini API 키는 `AIza...`이야. 이걸로 .env 파일 만들어줘."

---

## 🎬 3. 실행 및 사용법 (Usage)

### 1) 서버 실행
터미널에서 아래 명령어를 입력하세요.
```bash
node server.js
```
또는 Vibe에게 시키세요:
> "비디오 생성기 서버 시작해줘."

### 2) 웹 화면 접속
서버가 실행되면 브라우저를 열고 아래 주소로 접속하세요.
- **주소**: [http://localhost:3000](http://localhost:3000)

### 3) 비디오 생성
웹 화면에서 안내에 따라 텍스트를 입력하고 비디오를 생성할 수 있습니다.

---

## 📄 라이선스
이 프로젝트는 Rejard에 의해 관리됩니다.
