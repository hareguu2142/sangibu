import mongoose from 'mongoose';

const RevisionSchema = new mongoose.Schema({
  version: Number,
  diffText: String,        // jsdiff 결과 텍스트
  note: String,            // 수정 메모
  modifiedBy: String,      // 이름/역할
  modifiedAt: { type: Date, default: Date.now }
}, { _id: false });

const RecordSchema = new mongoose.Schema({
  collectionCode: { type: String, index: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', index: true },
  subject: { type: String, index: true },
  content: { type: String, default: '' },
  revisions: [RevisionSchema]
}, { timestamps: true });

RecordSchema.index({ collectionCode: 1, student: 1, subject: 1 }, { unique: true });

export default mongoose.model('Record', RecordSchema);
