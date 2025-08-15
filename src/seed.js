import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Collection from './models/Collection.js';
import Student from './models/Student.js';
import Teacher from './models/Teacher.js';
import Record from './models/Record.js';

dotenv.config();
const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI 필요'); process.exit(1); }

await mongoose.connect(uri);

async function run() {
  console.log('Seeding...');
  const code = 'test';
  const name = '샘플 생활기록부';
  await Collection.deleteMany({ code });
  await Student.deleteMany({ collectionCode: code });
  await Teacher.deleteMany({ collectionCode: code });
  await Record.deleteMany({ collectionCode: code });

  await Collection.create({ code, name, adminKey: 'admin' });

  const sampleStudents = [
    { grade:1, klass:2, number:3, name:'김영찬', studentCardCode:'test' },
    { grade:1, klass:2, number:4, name:'이하늘', studentCardCode:'s1002' },
    { grade:1, klass:3, number:1, name:'박새로이', studentCardCode:'s1003' }
  ];
  for (const s of sampleStudents) {
    const stu = await Student.create({ collectionCode: code, ...s });
    for (const subj of ['국어', '수학']) {
      await Record.create({
        collectionCode: code,
        student: stu._id,
        subject: subj,
        content: `${stu.name}의 ${subj} 생활기록부 초안입니다.`,
        revisions: []
      });
    }
  }

  await Teacher.create({ collectionCode: code, teacherId:'TCH001', name:'담임선생님' });
  console.log('Done. 코드: test / 학생증코드: test / 교사고유번호: TCH001');
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
