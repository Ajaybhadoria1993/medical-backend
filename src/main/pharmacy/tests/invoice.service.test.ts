// import * as invoiceService from '../services/invoice.service';
// import { database } from '../../../configurations/dbConnection';

// function makeQueryResult<T>(resolved: T) {
//   const q: any = {};
//   q.from = jest.fn(() => q);
//   q.where = jest.fn(() => q);
//   q.limit = jest.fn(() => q);
//   q.offset = jest.fn(() => q);
//   q.innerJoin = jest.fn(() => q);
//   q.leftJoin = jest.fn(() => q);
//   q.groupBy = jest.fn(() => q);
//   q.having = jest.fn(() => q);
//   q.orderBy = jest.fn(() => q);
//   q.then = (onFulfilled: any, onRejected: any) =>
//     Promise.resolve(resolved).then(onFulfilled, onRejected);
//   return q;
// }

// describe('Invoice Service Unit Tests', () => {
//   beforeEach(() => {
//     jest.clearAllMocks();
//   });

//   describe('resolvePharmacyIdForUser', () => {
//     it('should return pharmacyId if found', async () => {
//       (database.select as jest.Mock).mockReturnValue({
//         from: jest.fn().mockReturnValue({
//           where: jest.fn().mockReturnValue({
//             limit: jest.fn().mockResolvedValue([{ pharmacyId: 'pharm123' }]),
//           }),
//         }),
//       });

//   describe('getMedicineStock', () => {
//     it('should return stock details', async () => {
//       const now = new Date();

//       const result = await invoiceService.getMedicineStock(
//         'prod1',
//         'clinic1',
//         'pharm1'
//       );

//     it('should return OUT_OF_STOCK if quantity is 0', async () => {
//       const now = new Date();

//       const result = await invoiceService.getMedicineStock(
//         'prod1',
//         'clinic1',
//         'pharm1'
//       );

//   describe('getMedicineInventory', () => {
//     it('should return consumption details', async () => {
//       const now = new Date();

//       const result = await invoiceService.getMedicineInventory(
//         'prod1',
//         'clinic1',
//         'pharm1'
//       );

//   // Add more tests for createInvoice, updateInvoice etc.
//   // Note: Mocking transaction and complex queries requires more detailed mocks.
// });
