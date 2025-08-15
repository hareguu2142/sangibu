import mongoose from 'mongoose';

const StudentSchema = new mongoose.Schema({
  collectionCode: { type: String, index: true },
  grade: Number,         // 학년
  klass: Number,         // 반 (class 예약어 피함)
  number: Number,        // 번호
  name: String,
  studentCardCode: { type: String, index: true }, // 학생증코드
}, { timestamps: true });

StudentSchema.index({ collectionCode: 1, studentCardCode: 1 }, { unique: true });

export default mongoose.model('Student', StudentSchema);
