import mongoose from 'mongoose';

const RecordSeenSchema = new mongoose.Schema({
  record: { type: mongoose.Schema.Types.ObjectId, ref: 'Record', index: true },
  viewerType: { type: String, enum: ['student', 'teacher'], index: true },
  viewerKey: { type: String, index: true }, // student: 학생증코드, teacher: 교사고유번호
  lastSeenAt: { type: Date, default: new Date(0) }
}, { timestamps: true });

RecordSeenSchema.index({ record: 1, viewerType: 1, viewerKey: 1 }, { unique: true });

export default mongoose.model('RecordSeen', RecordSeenSchema);
