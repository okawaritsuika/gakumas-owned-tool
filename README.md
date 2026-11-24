# 학마 보유노트 소스코드

학원 아이돌마스터의 보유 목록과 육성 편성 추천 도구를 검토할 때 보는 소스 저장소입니다.

| 경로 | 코드 |
| --- | --- |
| app/server.mjs | 로컬 HTTP 서버와 추천 API |
| app/lib/ | 카탈로그 연결, 편성 탐색, 육성 일정·효과 계산 |
| app/web/ | 보유 목록·추천·공략 화면 |
| app/test/ | Node.js 회귀 검사와 코드로 작성된 검사용 데이터 |
| collector/ | Windows 보유 목록 수집기와 합성 환경 검사 |
| work/build_collector* | 수집기와 검사 환경의 빌드 스크립트 |

참고용 공유본에는 이미지, 실행 파일, 개인 보유 목록과 설치 상태, 별도 카탈로그·조사 자료가 빠져 있습니다. 일부 테스트와 추천 화면의 전체 동작에는 로컬 카탈로그나 별도 검사용 데이터가 필요합니다. 독립적으로 실행 가능한 검사 예시는 Node.js 20.11 이상에서 다음과 같습니다.

~~~sh
cd app
node --test test/collector-mode.test.mjs test/hif-bonuses.test.mjs test/hif-battle-stage.test.mjs
~~~

수집기 구성과 검사 방법은 [collector/README.md](collector/README.md)에 있습니다. 함께 포함된 외부 코드의 라이선스는 각 소스 옆과 app/data/licenses/에 있습니다.
