import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import methodOverride from 'method-override';
import multer from 'multer';
import { parse } from 'csv-parse';
import dayjs from 'dayjs';
import * as Diff from 'diff';
import morgan from 'morgan';

import Collection from './models/Collection.js';
import Student from './models/Student.js';
import Teacher from './models/Teacher.js';
import Record from './models/Record.js';
import RecordSeen from './models/RecordSeen.js';

dotenv.config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import expressLayouts from 'express-ejs-layouts';
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(expressLayouts);
app.set('layout', 'layout');

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(morgan('dev'));

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ .env의 MONGODB_URI를 설정하세요.');
  process.exit(1);
}
await mongoose.connect(MONGODB_URI);
console.log('✅ MongoDB connected');

// 공용 헬퍼
function viewKey(viewerType, studentCardCode, teacherId) {
  return viewerType === 'student' ? studentCardCode : teacherId;
}
async function markSeen(recordId, viewerType, viewerKey) {
  if (!viewerType || !viewerKey) return;
  await RecordSeen.findOneAndUpdate(
    { record: recordId, viewerType, viewerKey },
    { $set: { lastSeenAt: new Date() } },
    { upsert: true }
  );
}
async function hasUnseen(record, viewerType, viewerKey) {
  if (!viewerType || !viewerKey) return false;
  const seen = await RecordSeen.findOne({ record: record._id, viewerType, viewerKey });
  if (!seen) return true;
  return (record.updatedAt > seen.lastSeenAt);
}

// ============ 1탭 ============
app.get('/', (req, res) => {
  res.render('tab1', { title: '생활기록부 - 입장/생성' });
});

// 생성: adminKey + name + code
app.post('/collections/create', async (req, res) => {
  try {
    const { adminKey, name, code } = req.body;
    if (!adminKey || !name || !code) return res.status(400).send('필수값 누락');

    const exists = await Collection.findOne({ code });
    if (exists) return res.status(400).send('이미 존재하는 코드입니다.');

    await Collection.create({ adminKey, name, code });
    res.redirect(`/c/${encodeURIComponent(code)}?viewer=teacher&teacherId=ADMIN`);
  } catch (e) {
    res.status(500).send('생성 오류: ' + e.message);
  }
});

// 학생 입장
app.post('/collections/join', async (req, res) => {
  const { code, studentCardCode } = req.body;
  const coll = await Collection.findOne({ code });
  if (!coll) return res.status(404).send('없는 코드입니다.');
  if (!studentCardCode) return res.status(400).send('학생증코드를 입력하세요.');
  res.redirect(`/c/${encodeURIComponent(code)}?viewer=student&studentCardCode=${encodeURIComponent(studentCardCode)}`);
});

// 교사 입장
app.post('/collections/join-teacher', async (req, res) => {
  const { code, teacherId } = req.body;
  const coll = await Collection.findOne({ code });
  if (!coll) return res.status(404).send('없는 코드입니다.');
  if (!teacherId) return res.status(400).send('교사고유번호를 입력하세요.');
  // 등록된 교사만 필터링하려면 주석 해제
  // const t = await Teacher.findOne({ collectionCode: code, teacherId });
  // if (!t) return res.status(403).send('등록되지 않은 교사입니다.');
  res.redirect(`/c/${encodeURIComponent(code)}?viewer=teacher&teacherId=${encodeURIComponent(teacherId)}`);
});

// 관리자 탭 버튼 -> 4탭
app.get('/admin', (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/');
  res.redirect(`/admin/${encodeURIComponent(code)}`);
});

// ============ 2탭(리스트) ============
// viewer=student&studentCardCode=...  또는 viewer=teacher&teacherId=...
app.get('/c/:code', async (req, res) => {
  const { code } = req.params;
  const { viewer, studentCardCode, teacherId } = req.query;
  const coll = await Collection.findOne({ code });
  if (!coll) return res.status(404).send('없는 코드');

  let records;
  let viewerType = viewer === 'teacher' ? 'teacher' : 'student';

  if (viewerType === 'student') {
    const st = await Student.findOne({ collectionCode: code, studentCardCode });
    if (!st) return res.status(404).send('학생을 찾지 못했습니다.');
    records = await Record.find({ collectionCode: code, student: st._id })
      .populate('student').sort({ updatedAt: -1 });
  } else {
    // 교사: 전체
    records = await Record.find({ collectionCode: code })
      .populate('student').sort({ updatedAt: -1 });
  }

  const viewerKey = viewKey(viewerType, studentCardCode, teacherId);
  const list = [];
  for (const r of records) {
    const highlight = await hasUnseen(r, viewerType, viewerKey);
    list.push({
      id: r._id.toString(),
      grade: r.student.grade,
      klass: r.student.klass,
      number: r.student.number,
      name: r.student.name,
      subject: r.subject,
      updatedAt: dayjs(r.updatedAt).format('YYYY-MM-DD HH:mm'),
      highlight
    });
  }

  res.render('tab2', {
    title: `공유 리스트: ${coll.name} (${code})`,
    code,
    viewerType,
    studentCardCode,
    teacherId,
    list
  });
});

// ============ 3탭(상세 + 이력) ============
app.get('/r/:id', async (req, res) => {
  const { id } = req.params;
  const { viewer, studentCardCode, teacherId } = req.query;
  const viewerType = viewer === 'teacher' ? 'teacher' : 'student';
  const viewerKey = viewKey(viewerType, studentCardCode, teacherId);

  const record = await Record.findById(id).populate('student');
  if (!record) return res.status(404).send('기록 없음');

  // 열람 표시(강조 해제용)
  await markSeen(record._id, viewerType, viewerKey);

  res.render('tab3', {
    title: `상세: ${record.student?.name} - ${record.subject}`,
    record,
    code: record.collectionCode,
    viewerType,
    studentCardCode,
    teacherId,
    dayjs
  });
});

// 수정 반영 (내용 + 메모 + 수정자 이름)
app.post('/r/:id/edit', async (req, res) => {
  const { id } = req.params;
  const { content, note, modifiedBy, viewerType, studentCardCode, teacherId } = req.body;
  const record = await Record.findById(id).populate('student');
  if (!record) return res.status(404).send('기록 없음');

  const old = record.content || '';
  const newC = content || '';
  const diffParts = Diff.createTwoFilesPatch('before', 'after', old, newC, '', '');
  const nextVer = (record.revisions?.length || 0) + 1;

  record.revisions.push({
    version: nextVer,
    diffText: diffParts,
    note: note || '',
    modifiedBy: modifiedBy || 'unknown'
  });
  record.content = newC;
  await record.save();

  res.redirect(`/r/${id}?viewer=${viewerType}${viewerType==='student' ? `&studentCardCode=${encodeURIComponent(studentCardCode||'')}` : `&teacherId=${encodeURIComponent(teacherId||'')}`}`);
});

// ============ 4탭(관리자) ============
app.get('/admin/:code', async (req, res) => {
  const { code } = req.params;
  const tab = req.query.tab || 'students';
  const coll = await Collection.findOne({ code });
  if (!coll) return res.status(404).send('없는 코드');

  const students = await Student.find({ collectionCode: code }).sort({ grade:1, klass:1, number:1 });
  const teachers = await Teacher.find({ collectionCode: code }).sort({ createdAt: -1 });

  res.render('tab4', {
    title: `관리자 설정 - ${coll.name} (${code})`,
    code,
    tab,
    students,
    teachers
  });
});

// 학생 추가
app.post('/admin/:code/students', async (req, res) => {
  const { code } = req.params;
  const { grade, klass, number, name, studentCardCode } = req.body;
  await Student.create({ collectionCode: code, grade, klass, number, name, studentCardCode });
  // 기본 과목 샘플 2개 생성(중복 방지)
  const st = await Student.findOne({ collectionCode: code, studentCardCode });
  for (const subj of ['국어', '수학']) {
    await Record.updateOne(
      { collectionCode: code, student: st._id, subject: subj },
      { $setOnInsert: { content: '', revisions: [] } },
      { upsert: true }
    );
  }
  res.redirect(`/admin/${code}?tab=students`);
});

// 학생 삭제
app.post('/admin/:code/students/:id/delete', async (req, res) => {
  const { code, id } = req.params;
  await Record.deleteMany({ collectionCode: code, student: id });
  await Student.findByIdAndDelete(id);
  res.redirect(`/admin/${code}?tab=students`);
});

// CSV 업로드 (UTF-8, 헤더: 학년,반,번호,이름,학생증코드)
app.post('/admin/:code/students/upload', upload.single('csv'), async (req, res) => {
  const { code } = req.params;
  if (!req.file) return res.status(400).send('CSV 파일이 없습니다.');
  try {
    const rows = [];
    await new Promise((resolve, reject) => {
      parse(req.file.buffer, { columns: true, trim: true, skip_empty_lines: true }, (err, records) => {
        if (err) return reject(err);
        for (const r of records) rows.push(r);
        resolve();
      });
    });

    // 컬럼명 한글 지원
    for (const r of rows) {
      const grade = Number(r['학년'] ?? r['grade'] ?? r['Grade']);
      const klass = Number(r['반'] ?? r['class'] ?? r['klass'] ?? r['Class']);
      const number = Number(r['번호'] ?? r['number'] ?? r['No'] ?? r['num']);
      const name = r['이름'] ?? r['name'] ?? r['Name'];
      const studentCardCode = r['학생증코드'] ?? r['studentCardCode'] ?? r['card'] ?? r['code'];

      if (!name || !studentCardCode) continue;
      const stu = await Student.findOneAndUpdate(
        { collectionCode: code, studentCardCode },
        { $set: { grade, klass, number, name } },
        { upsert: true, new: true }
      );
      for (const subj of ['국어', '수학']) {
        await Record.updateOne(
          { collectionCode: code, student: stu._id, subject: subj },
          { $setOnInsert: { content: '', revisions: [] } },
          { upsert: true }
        );
      }
    }
    res.redirect(`/admin/${code}?tab=students`);
  } catch (e) {
    res.status(500).send('CSV 처리 오류: ' + e.message);
  }
});

// 교사 추가
app.post('/admin/:code/teachers', async (req, res) => {
  const { code } = req.params;
  const { teacherId, name } = req.body;
  await Teacher.create({ collectionCode: code, teacherId, name });
  res.redirect(`/admin/${code}?tab=teachers`);
});

// 교사 삭제
app.post('/admin/:code/teachers/:id/delete', async (req, res) => {
  const { code, id } = req.params;
  await Teacher.findByIdAndDelete(id);
  res.redirect(`/admin/${code}?tab=teachers`);
});

// ============ 간단 CSS ============
app.get('/static/base.css', (req, res) => {
  res.type('text/css').send(`
  body { font-family: ui-sans-serif, system-ui, -apple-system; margin: 24px; }
  a { text-decoration: none; }
  .wrap { max-width: 1000px; margin: 0 auto; }
  .tabs a { margin-right: 12px; font-weight: 600; }
  .list { border-collapse: collapse; width: 100%; }
  .list th, .list td { border-bottom: 1px solid #ddd; padding: 8px 6px; }
  .pill { display:inline-block; padding:2px 8px; border-radius:999px; background:#eee; font-size:12px; }
  .hl { background: #fff6cc; }
  .row { display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
  input, select, textarea { padding:8px; border:1px solid #ddd; border-radius:8px; width:100%; max-width:320px;}
  button { padding:8px 12px; border:0; border-radius:8px; background:#1f7aed; color:#fff; cursor:pointer; }
  button.secondary { background:#555; }
  pre.diff { background:#0b1020; color:#e3e7ff; padding:12px; border-radius:8px; overflow:auto; }
  `);
});

// ============ 서버 시작 ============
app.listen(PORT, () => {
  console.log(`🚀 http://localhost:${PORT}`);
});
