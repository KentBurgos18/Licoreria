const sequelize = require('../config/database');
const Product = require('./Product');
const ProductComponent = require('./ProductComponent');
const InventoryMovement = require('./InventoryMovement');
const Sale = require('./Sale');
const SaleItem = require('./SaleItem');
const Customer = require('./Customer');
const GroupPurchase = require('./GroupPurchase');
const GroupPurchaseParticipant = require('./GroupPurchaseParticipant');
const CustomerPayment = require('./CustomerPayment');
const CustomerCredit = require('./CustomerCredit');
const Supplier = require('./Supplier');
const SupplierPrice = require('./SupplierPrice');
const Setting = require('./Setting');
const User = require('./User');
const Notification = require('./Notification');
const PushSubscription = require('./PushSubscription');
const PayphonePendingPayment = require('./PayphonePendingPayment');

// Initialize models
const models = {
  Product: Product(sequelize),
  ProductComponent: ProductComponent(sequelize),
  InventoryMovement: InventoryMovement(sequelize),
  Sale: Sale(sequelize),
  SaleItem: SaleItem(sequelize),
  Customer: Customer(sequelize),
  GroupPurchase: GroupPurchase(sequelize),
  GroupPurchaseParticipant: GroupPurchaseParticipant(sequelize),
  CustomerPayment: CustomerPayment(sequelize),
  CustomerCredit: CustomerCredit(sequelize),
  Supplier: Supplier(sequelize),
  SupplierPrice: SupplierPrice(sequelize),
  Setting: Setting(sequelize),
  User: User(sequelize),
  Notification: Notification(sequelize),
  PushSubscription: PushSubscription(sequelize),
  PayphonePendingPayment: PayphonePendingPayment(sequelize)
};

// Setup associations
Object.keys(models).forEach(modelName => {
  if (models[modelName].associate) {
    models[modelName].associate(models);
  }
});

// Export sequelize and models
module.exports = {
  sequelize,
  ...models
};