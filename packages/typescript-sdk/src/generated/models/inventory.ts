//Generated file, please do not change

import { ChannelResourceIdentifier } from './channel'
import {
  CreatedBy,
  LastModifiedBy,
  LoggedResource,
  Reference,
  ReferenceTypeId,
  ResourceIdentifier,
} from './common'
import {
  CustomFields,
  CustomFieldsDraft,
  FieldContainer,
  TypeResourceIdentifier,
} from './type'

export interface InventoryEntry extends LoggedResource {
  readonly sku: string

  readonly supplyChannel?: ChannelResourceIdentifier

  readonly quantityOnStock: number

  readonly availableQuantity: number

  readonly restockableInDays?: number

  readonly expectedDelivery?: string

  readonly custom?: CustomFields
}

export interface InventoryEntryDraft {
  readonly sku: string

  readonly supplyChannel?: ChannelResourceIdentifier

  readonly quantityOnStock: number

  readonly restockableInDays?: number

  readonly expectedDelivery?: string

  readonly custom?: CustomFieldsDraft
}

export interface InventoryEntryReference {
  readonly typeId: 'inventory-entry'

  readonly id: string

  readonly obj?: InventoryEntry
}

export interface InventoryEntryResourceIdentifier {
  readonly typeId: 'inventory-entry'

  readonly id?: string

  readonly key?: string
}

export interface InventoryEntryUpdate {
  readonly version: number

  readonly actions: InventoryEntryUpdateAction[]
}

export type InventoryEntryUpdateAction =
  | InventoryEntryAddQuantityAction
  | InventoryEntryChangeQuantityAction
  | InventoryEntryRemoveQuantityAction
  | InventoryEntrySetCustomFieldAction
  | InventoryEntrySetCustomTypeAction
  | InventoryEntrySetExpectedDeliveryAction
  | InventoryEntrySetRestockableInDaysAction
  | InventoryEntrySetSupplyChannelAction

export interface InventoryPagedQueryResponse {
  readonly limit: number

  readonly count: number

  readonly total?: number

  readonly offset: number

  readonly results: InventoryEntry[]
}

export interface InventoryEntryAddQuantityAction {
  readonly action: 'addQuantity'

  readonly quantity: number
}

export interface InventoryEntryChangeQuantityAction {
  readonly action: 'changeQuantity'

  readonly quantity: number
}

export interface InventoryEntryRemoveQuantityAction {
  readonly action: 'removeQuantity'

  readonly quantity: number
}

export interface InventoryEntrySetCustomFieldAction {
  readonly action: 'setCustomField'

  readonly name: string

  readonly value?: object
}

export interface InventoryEntrySetCustomTypeAction {
  readonly action: 'setCustomType'

  readonly fields?: FieldContainer

  readonly type?: TypeResourceIdentifier
}

export interface InventoryEntrySetExpectedDeliveryAction {
  readonly action: 'setExpectedDelivery'

  readonly expectedDelivery?: string
}

export interface InventoryEntrySetRestockableInDaysAction {
  readonly action: 'setRestockableInDays'

  readonly restockableInDays?: number
}

export interface InventoryEntrySetSupplyChannelAction {
  readonly action: 'setSupplyChannel'

  readonly supplyChannel?: ChannelResourceIdentifier
}