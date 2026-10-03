param location string = resourceGroup().location
param suffix string
param ownerObjectId string
param tenantId string = tenant().tenantId
param microsoftClientId string
@secure()
param microsoftClientSecret string
@secure()
param dataKey string

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'amstore${suffix}'
  location: location
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
  }
}
resource files 'Microsoft.Storage/storageAccounts/fileServices@2023-05-01' = {
  parent: storage
  name: 'default'
}
resource share 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-05-01' = {
  parent: files
  name: 'applymate'
  properties: { shareQuota: 5 }
}
resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}
resource leases 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobs
  name: 'runtime'
  properties: { publicAccess: 'None' }
}
resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: 'amregistry${suffix}'
  location: location
  sku: { name: 'Basic' }
  properties: { adminUserEnabled: false }
}
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'applymate-pilot'
  location: location
}
resource registryReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: registry
  name: guid(registry.id, identity.id, 'AcrPull')
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
  }
}
resource leaseAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storage
  name: guid(storage.id, identity.id, 'BlobDataContributor')
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
  }
}
resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: 'amkeys${suffix}'
  location: location
  properties: {
    tenantId: tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: false
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    accessPolicies: [{
      tenantId: tenantId
      objectId: identity.properties.principalId
      permissions: { secrets: ['get'] }
    }]
  }
}
resource key 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'data-key'
  properties: { value: dataKey }
}
resource loginSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'microsoft-login'
  properties: { value: microsoftClientSecret }
}
resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'applymate-pilot'
  location: location
  properties: {
    workloadProfiles: [{ name: 'Consumption', workloadProfileType: 'Consumption' }]
  }
}
resource mountedStorage 'Microsoft.App/managedEnvironments/storages@2024-03-01' = {
  parent: environment
  name: 'private-data'
  properties: {
    azureFile: {
      accountName: storage.name
      accountKey: storage.listKeys().keys[0].value
      shareName: share.name
      accessMode: 'ReadWrite'
    }
  }
}

output registryName string = registry.name
output registryHost string = registry.properties.loginServer
output environmentId string = environment.id
output environmentDomain string = environment.properties.defaultDomain
output identityId string = identity.id
output identityClientId string = identity.properties.clientId
output leaseUrl string = 'https://${storage.name}.blob.core.windows.net/runtime/lease'
output dataKeyUri string = key.properties.secretUri
output loginSecretUri string = loginSecret.properties.secretUri
output clientId string = microsoftClientId
output owner string = ownerObjectId
