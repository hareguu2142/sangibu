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
// --- 상단 import/초기화 부분 아래에 추가 ---
import fs from 'fs';
// EJS views 경로 자동 탐지 (src/views 우선, 없으면 프로젝트 루트/views)
const viewsCandidates = [
  path.join(__dirname, 'views'),
  path.join(process.cwd(), 'views'),
];

const resolvedViewsDir = viewsCandidates.find(dir => fs.existsSync(dir));
if (!resolvedViewsDir) {
  console.warn('⚠️  views 디렉터리를 찾지 못했습니다. src/views 또는 프로젝트루트/views 위치를 확인하세요.');
}
app.set('views', resolvedViewsDir || path.join(__dirname, 'views'));

app.set('view engine', 'ejs');

// layout.ejs가 어디에 있는지도 점검
const layoutCandidates = [
  path.join(app.get('views') || '', 'layout.ejs'),
  path.join(app.get('views') || '', 'layouts', 'layout.ejs'),
];
const hasLayout = layoutCandidates.some(p => fs.existsSync(p));
if (!hasLayout) {
  console.warn('⚠️  layout.ejs를 views/ 또는 views/layouts/ 아래에 두세요. 현재 파일을 찾지 못했습니다.');
}
app.set('layout', 'layout');

app.use(expressLayouts);
app.set('layout', 'layout');

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(morgan('dev'));

const PORT = 3000;
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

// --- 미들웨어들 다음, 라우트들 맨 위 근처 ---
app.get('/healthz', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// 템플릿 문제 시에도 살아있음을 확인할 수 있는 텍스트 루트
app.get('/plain', (req, res) => {
  res.type('text/plain').send('Service up (plain). If EJS fails, check /plain and logs.');
});

// ============ 1탭 ============
app.get('/', (req, res) => {
  res.render('tab1', { title: '생활기록부 - 입장/생성' });
});

// ============ 공유 탭 ============
app.get('/collections/share', (req, res) => {
  res.render('tab_share', { title: '생활기록부 - 공유' });
});

app.post('/collections/share', async (req, res) => {
  try {
    const { studentName, studentCardCode, collectionCode } = req.body;
    // Basic validation
    if (!studentName || !studentCardCode || !collectionCode) {
      return res.status(400).send('모든 필드를 입력해주세요.');
    }

    // Here you would typically add logic to handle the sharing,
    // for example, creating a shareable link or sending a notification.
    // For now, we'll just redirect back to the share page with a success message.
    // NOTE: A full implementation would require more complex logic.
    console.log(`Sharing collection ${collectionCode} with student ${studentName} (${studentCardCode})`);

    // Redirect or render a success page
    res.send(`'${collectionCode}' 생활기록부를 학생 '${studentName}'에게 공유하는 기능은 아직 구현되지 않았습니다. 하지만 UI는 준비되었습니다.`);

  } catch (error) {
    console.error('Share error:', error);
    res.status(500).send('공유 처리 중 오류가 발생했습니다.');
  }
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

// 새 기록 추가 (폼)
app.get('/c/:code/new', async (req, res) => {
  const { code } = req.params;
  const { teacherId } = req.query;
  const coll = await Collection.findOne({ code });
  if (!coll) return res.status(404).send('없는 코드');
  const students = await Student.find({ collectionCode: code }).sort({ grade: 1, klass: 1, number: 1 });
  res.render('tab5_new_record', {
    title: '새 기록 추가',
    code,
    teacherId,
    students,
    subjects: coll.subjects,
  });
});

// 새 기록 추가 (처리)
app.post('/c/:code/new', async (req, res) => {
  const { code } = req.params;
  const { studentId, subject, content, teacherId } = req.body;
  const student = await Student.findById(studentId);
  if (!student || student.collectionCode !== code) {
    return res.status(400).send('잘못된 학생 정보');
  }
  const record = await Record.create({
    collectionCode: code,
    student: studentId,
    subject,
    content,
    revisions: [{
      version: 1,
      diffText: Diff.createTwoFilesPatch('before', 'after', '', content, '', ''),
      note: '최초 생성',
      modifiedBy: teacherId,
    }],
  });
  res.redirect(`/r/${record._id}?viewer=teacher&teacherId=${encodeURIComponent(teacherId)}`);
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

// Admin용 미들웨어
async function checkAdminKey(req, res, next) {
  const { code } = req.params;
  const { adminKey } = req.query;
  const coll = await Collection.findOne({ code });
  if (!coll) return res.status(404).send('없는 코드');
  if (adminKey !== coll.adminKey) {
    return res.status(403).send('접근 권한이 없습니다. Admin Key를 확인하세요.');
  }
  next();
}

app.get('/admin/:code', async (req, res) => {
  const { code } = req.params;
  const coll = await Collection.findOne({ code });
  if (!coll) return res.status(404).send('없는 코드');

  // adminKey 체크를 제거하고 바로 관리자 페이지를 보여줌
  const tab = req.query.tab || 'students';
  const students = await Student.find({ collectionCode: code }).sort({ grade:1, klass:1, number:1 });
  const teachers = await Teacher.find({ collectionCode: code }).sort({ createdAt: -1 });

  res.render('tab4', {
    title: `관리자 설정 - ${coll.name} (${code})`,
    code,
    needsAuth: false, // 항상 false로 설정하여 인증 폼을 숨김
    error: null,
    tab,
    students,
    teachers,
    subjects: coll.subjects,
    adminKey: coll.adminKey, // DB에서 가져온 adminKey를 템플릿에 전달
  });
});

// 학생 추가
app.post('/admin/:code/students', checkAdminKey, async (req, res) => {
  const { code } = req.params;
  const { adminKey } = req.query;
  const { grade, klass, number, name, studentCardCode } = req.body;
  const coll = await Collection.findOne({ code });
  if (!coll) return res.status(404).send('없는 코드');

  await Student.create({ collectionCode: code, grade, klass, number, name, studentCardCode });
  // 기본 과목 샘플 2개 생성(중복 방지)
  const st = await Student.findOne({ collectionCode: code, studentCardCode });
  for (const subj of coll.subjects) {
    await Record.updateOne(
      { collectionCode: code, student: st._id, subject: subj },
      { $setOnInsert: { content: '', revisions: [] } },
      { upsert: true }
    );
  }
  res.redirect(`/admin/${code}?tab=students&adminKey=${adminKey}`);
});

// 학생 삭제
app.post('/admin/:code/students/:id/delete', checkAdminKey, async (req, res) => {
  const { code, id } = req.params;
  const { adminKey } = req.query;
  await Record.deleteMany({ collectionCode: code, student: id });
  await Student.findByIdAndDelete(id);
  res.redirect(`/admin/${code}?tab=students&adminKey=${adminKey}`);
});

// CSV 업로드 (UTF-8, 헤더: 학년,반,번호,이름,학생증코드)
app.post('/admin/:code/students/upload', checkAdminKey, upload.single('csv'), async (req, res) => {
  const { code } = req.params;
  const { adminKey } = req.query;
  if (!req.file) return res.status(400).send('CSV 파일이 없습니다.');
  const coll = await Collection.findOne({ code });
  if (!coll) return res.status(404).send('없는 코드');
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
      for (const subj of coll.subjects) {
        await Record.updateOne(
          { collectionCode: code, student: stu._id, subject: subj },
          { $setOnInsert: { content: '', revisions: [] } },
          { upsert: true }
        );
      }
    }
    res.redirect(`/admin/${code}?tab=students&adminKey=${adminKey}`);
  } catch (e) {
    res.status(500).send('CSV 처리 오류: ' + e.message);
  }
});

// 교사 추가
app.post('/admin/:code/teachers', checkAdminKey, async (req, res) => {
  const { code } = req.params;
  const { adminKey } = req.query;
  const { teacherId, name } = req.body;
  await Teacher.create({ collectionCode: code, teacherId, name });
  res.redirect(`/admin/${code}?tab=teachers&adminKey=${adminKey}`);
});

// 교사 삭제
app.post('/admin/:code/teachers/:id/delete', checkAdminKey, async (req, res) => {
  const { code, id } = req.params;
  const { adminKey } = req.query;
  await Teacher.findByIdAndDelete(id);
  res.redirect(`/admin/${code}?tab=teachers&adminKey=${adminKey}`);
});

// 과목 추가
app.post('/admin/:code/subjects', checkAdminKey, async (req, res) => {
  const { code } = req.params;
  const { adminKey } = req.query;
  const { subject } = req.body;
  if (subject) {
    await Collection.updateOne({ code }, { $addToSet: { subjects: subject } });
  }
  res.redirect(`/admin/${code}?tab=subjects&adminKey=${adminKey}`);
});

// 과목 삭제
app.post('/admin/:code/subjects/delete', checkAdminKey, async (req, res) => {
  const { code } = req.params;
  const { adminKey } = req.query;
  const { subject } = req.body;
  if (subject) {
    await Collection.updateOne({ code }, { $pull: { subjects: subject } });
  }
  res.redirect(`/admin/${code}?tab=subjects&adminKey=${adminKey}`);
});

// ============ Static Files ============
app.use('/static', express.static(path.join(__dirname, 'static')));

// ============ 서버 시작 ============
app.listen(PORT, () => {
  console.log(`🚀 http://localhost:${PORT}`);
});

// 404 핸들러
app.use((req, res, next) => {
  res.status(404).type('text/plain').send('404 Not Found (express). Check the URL or routes.');
});

// 에러 핸들러
app.use((err, req, res, next) => {
  console.error('💥 ERROR:', err);
  res.status(500).type('text/plain').send('500 Internal Server Error.\n' + (err?.message || ''));
});
