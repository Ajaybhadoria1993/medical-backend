// import request from 'supertest';
// import express from 'express';
// import * as invoiceService from '../services/invoice.service';
// import invoiceRouter from '../routes/v1/invoice.route';
// import { errorHandler } from '../../../middlewear/errorHandler';

// // Mock the service
// jest.mock('../services/invoice.service');

// const app = express();
// app.use(express.json());
// app.use('/api/v1/pharmacy/invoice', invoiceRouter);
// app.use(errorHandler);

// describe('Invoice Integration Tests', () => {
//   beforeEach(() => {
//     jest.clearAllMocks();
//   });

//       (invoiceService.resolvePharmacyIdForUser as jest.Mock).mockResolvedValue(
//         '123e4567-e89b-12d3-a456-426614174001'
//       );
//       (invoiceService.getMedicineStock as jest.Mock).mockResolvedValue(
//         mockStockInfo
//       );

//       const response = await request(app).get(
//         '/api/v1/pharmacy/invoice/stock/123e4567-e89b-12d3-a456-426614174000'
//       );

//       (invoiceService.resolvePharmacyIdForUser as jest.Mock).mockResolvedValue(
//         '123e4567-e89b-12d3-a456-426614174001'
//       );
//       (invoiceService.getMedicineInventory as jest.Mock).mockResolvedValue(
//         mockInventoryInfo
//       );

//       const response = await request(app).get(
//         '/api/v1/pharmacy/invoice/inventory/123e4567-e89b-12d3-a456-426614174000'
//       );

//       (invoiceService.createInvoice as jest.Mock).mockResolvedValue(
//         mockInvoice
//       );

//       (invoiceService.resolvePharmacyIdForUser as jest.Mock).mockResolvedValue(
//         'pharm123'
//       );
//       (invoiceService.getInvoiceDetails as jest.Mock).mockResolvedValue(
//         mockResult
//       );

//       const response = await request(app).get('/api/v1/pharmacy/invoice');
