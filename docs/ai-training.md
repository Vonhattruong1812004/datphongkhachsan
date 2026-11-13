# Bento NLU: mo hinh hoc may v1

## Pham vi va trang thai

Da train **TF-IDF ky tu 3-5 gram + Multinomial Logistic Regression** bang scikit-learn.
Day la supervised machine learning: vocabulary, IDF, he so va intercept duoc hoc tu du lieu gan nhan,
khong phai sao chep diem cua bo luat cu lam nhan. Khong phai LLM, deep learning, RAG hoac chatbot sinh van ban.

Mo hinh chi phan loai y dinh. Trich xuat ngay/gia/so khach, truy van phong, xep hang, tinh tien va
cau tra loi van theo nghiep vu hien co. Model khong co quyen tao/huy booking, xac nhan tien, hoan tien
hay tu bo qua kiem tra suc chua, lich phong va quyen truy cap.

**Mac dinh `shadow`**, vi benchmark seed chua du de trien khai tu dong cho khach that.
Mo hinh van suy luan va tra metadata `data.nlu` nhung khong thay doi routing.
`on` la che do hybrid thu nghiem; `off` tat suy luan. Gia tri cau hinh khong hop le ve `shadow`.
Khong thay schema database. Khong gui hoi thoai/booking sang dich vu AI ngoai.

## Du lieu

- File: `ml/data/intents.vi.json`, version `bento-intents-seed-v1`.
- **390 cau do coding assistant soan va gan nhan**, chua duoc nguoi danh gia doc lap duyet.
- Khong phai hoi thoai khach that, khong phai du lieu thu thap tu san pham, khong dung PII.
- 13 lop: booking, room_alternative, destination_alternative, nearby, packing, itinerary,
  checkin, checkout, payment, refund, service, account, other.
- Train 234 cau/78 nhom; validation 78 cau/26 nhom; test 78 cau/26 nhom.
- Moi nhom gom cac cach dien dat cua mot tinh huong; ca nhom chi nam trong mot split.
- Chan cau trung nhau sau chuan hoa, ke ca bien the co dau/khong dau. Day khong phai bo phat hien
  trung ngu nghia toan dien: du lieu van can duoc con nguoi ra soat de tranh leakage tinh te.

Kiem tra CSDL luc trien khai: 185 giao dich, 73 khach co chi tiet dat phong, 173 dong phong dat.
Chua co bang interaction/impression/click rieng trong schema dang dung. Khong lay phong ngau nhien
lam nhan "khach khong thich", khong train ranker tu diem heuristic hay booking demo roi goi la
bang chung ve hanh vi khach that.

## Thuat toan va danh gia

1. Chuan hoa chu thuong, dau tieng Viet, dau cau va khoang trang; toi da 2.000 ky tu dau vao.
2. Fit TF-IDF **chi tren train**: char 3-5 gram, toi da 6.000 features, sublinear TF, L2 normalization.
3. Train logistic regression L2, solver lbfgs, max_iter 2000, random_state 42; thu C = 1, 4, 16, 64.
4. Chon dong thoi C, nguong probability va margin tren validation. Uu tien coverage cao nhat
   voi macro-F1 >= 0,70, precision cac cau chap nhan >= 0,95, it nhat 20 cau chap nhan.
5. Sau khi chot, danh gia test mot lan; khong fit vocabulary/IDF/weights/threshold tren test.
6. So sanh voi most-frequent va Complement Naive Bayes. Xuat per-class F1, confusion matrix,
   loi du doan, selective precision va coverage. Neu sua model sau khi xem test, phai cong bo
   viec test da duoc xem va bo sung mot tap test doc lap moi truoc khi bao cao generalization.

Ket qua v1 (du lieu seed noi bo, khong phai do chinh xac voi khach that):

| Chi so | Ket qua |
| --- | --- |
| C duoc chon | 64 |
| Nguong / margin | 0,45 / 0,10 |
| Validation macro-F1 | 0,7132 |
| Test accuracy | 56/78 = 71,79% |
| Test macro-F1 | 0,6989 |
| Test ComplementNB macro-F1 | 0,6662 |
| Test most-frequent macro-F1 | 0,0110 |
| Test selective precision | 41/45 = 91,11% |
| Test coverage | 45/78 = 57,69% |

Khong duoc chi cong bo 91,11% ma bo qua 33 cau model tu choi va 4 cau chap nhan nhung sai.
Probability la softmax cua model, **chua calibration**, khong phai cam ket do tin cay.
Loi con lai co nham refund/account/payment va ca cau ngoai pham vi. Gate validation khong
bao dam precision test; test chua dat moc 95%, nen khong bat routing ML mac dinh.
Bao cao day du: `ml/reports/intent-evaluation.json`. Day la baseline, chua phai nghien cuu hoan chinh.

## Chay lai

Tu thu muc `bento-booking` (Python 3.12):

```sh
python3 -m venv .venv-ai
.venv-ai/bin/python -m pip install -r ml/requirements.txt
npm run ai:train
npm run ai:evaluate
.venv-ai/bin/python -m unittest discover -s ml -p 'test_*.py'
npm run ai:test
npm test
npm run build:server
```

Train lai ghi de artifact candidate va bao cao; luu version cu bang Git truoc khi thay dataset.
`ai:evaluate` chi nap weights da train va tinh lai test, khong fit hay doi nguong.
Dependencies duoc pin, metadata co dataset SHA-256, Python/sklearn version, seed va hyperparameters.
Chenh lech floating point nho giua nen tang la co the; parity test dung tolerance 1e-9.

Artifact: `src/modules/ai/models/intent-model.json`. TypeScript import JSON nen build server
tu dong dua artifact vao `dist/modules/ai/models/`. Docker hien tai copy dist, khong can Python
o runtime. Khong dung pickle/joblib de nap artifact, khong can them AI server hay tai model khi khoi dong.

## Thu nghiem tich hop

```sh
# Che do mac dinh: suy luan song song, khong doi tra loi hien tai
AI_INTENT_MODEL=shadow PORT=3010 npm run dev:server
# Chi dung tren moi truong thu nghiem, sau khi dung server dang chiem port
AI_INTENT_MODEL=on PORT=3010 npm run dev:server
# Quay ve router cu
AI_INTENT_MODEL=off PORT=3010 npm run dev:server
```

`POST /api/ai/concierge` giu body cu. Metadata `data.nlu` bo sung:
mode, source, model_version, predicted_intent, probability, accepted, calibrated=false.
`accepted=true` khong dong nghia da ap dung: can `source=trained-model` va mode=on.
Context "khac", cho phep GPS va cac route nghiep vu ro rang van duoc uu tien.
Model thieu do chac chan thi dung router cu; router cu khong hieu thi hoi lai.

Vi du kiem thu duong ML: "Soan danh sach do di bien" duoc nhan dien packing, khong tim phong.
Do la cau trong train, chi dung smoke integration, **khong dung de chung minh tong quat hoa**.
Test parity doi chieu xac suat Node voi sklearn tren 78 cau test va dau vao rong/emoji.

## Semantic candidate v2

A frozen multilingual MiniLM encoder plus a trained, temperature-scaled linear head is
now available as an optional shadow-only candidate. It uses public CLINC/MASSIVE subsets
and separate calibration/test partitions. It is not a replacement for v1: Vietnamese
business-intent accuracy regressed despite a higher mixed-benchmark macro-F1.
See [v2 model card, sources, corrected results and reproduction commands](ai-semantic-v2.md).

## Buoc tiep theo cho khoa luan

1. Thu thap hoi thoai da dong y, an danh; tach thong tin ca nhan va khong commit vao Git.
2. It nhat hai nguoi duyet nhan, ghi quy tac gan nhan va xu ly bat dong, dac biet cau nhieu y dinh.
3. Tach theo nguoi/phien/thoi gian, bo sung test ben ngoai; bao cao tung lop va confidence intervals.
4. So sanh router cu, NLU nay va model ngu nghia tieng Viet. Khong chi so accuracy tren seed.
5. Thu thap impression/candidate set, click, shortlist, booking va huy de train Learning-to-Rank.
   Chi so NDCG@K, Recall@K va conversion; khong coi phong chua tung hien thi la negative that.
6. Giu availability/gia/suc chua la rang buoc bat buoc ngoai model. Chi rollout sau khi
   danh gia doc lap dat nguong va co fallback/rollback; khong fine-tune LLM tren PII.

Tham khao chinh thuc:
- https://scikit-learn.org/stable/modules/feature_extraction.html
- https://scikit-learn.org/stable/modules/generated/sklearn.linear_model.LogisticRegression.html
- https://scikit-learn.org/stable/common_pitfalls.html#data-leakage
