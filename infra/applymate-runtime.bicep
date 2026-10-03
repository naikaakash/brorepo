param location string = resourceGroup().location
param suffix string
param ownerObjectId string
param microsoftClientId string
param imageTag string
param publicIngress bool = false

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: 'amstore${suffix}'
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
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: 'applymate-pilot'
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
resource environment 'Microsoft.App/managedEnvironments@2024-03-01' existing = {
  name: 'applymate-pilot'
}
var hostname = 'applymate-personal.${environment.properties.defaultDomain}'
var origin = 'https://${hostname}'

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'applymate-personal'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identity.id}': {} }
  }
  properties: {
    managedEnvironmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: { external: publicIngress, targetPort: 8080, allowInsecure: false }
      registries: [{ server: 'amregistry${suffix}.azurecr.io', identity: identity.id }]
      secrets: [
        { name: 'data-key', keyVaultUrl: 'https://amkeys${suffix}.vault.azure.net/secrets/data-key', identity: identity.id }
        { name: 'microsoft-login', keyVaultUrl: 'https://amkeys${suffix}.vault.azure.net/secrets/microsoft-login', identity: identity.id }
      ]
    }
    template: {
      containers: [{
        name: 'applymate'
        image: 'amregistry${suffix}.azurecr.io/applymate:${imageTag}'
        resources: { cpu: json('0.5'), memory: '1Gi' }
        env: [
          { name: 'APPLYMATE_CLOUD', value: 'azure' }
          { name: 'APPLYMATE_ORIGIN', value: origin }
          { name: 'APPLYMATE_TENANT', value: tenant().tenantId }
          { name: 'APPLYMATE_OWNER', value: ownerObjectId }
          { name: 'APPLYMATE_DATA_DIR', value: '/home/applymate' }
          { name: 'APPLYMATE_DATA_KEY', secretRef: 'data-key' }
          { name: 'APPLYMATE_IDENTITY_CLIENT_ID', value: identity.properties.clientId }
          { name: 'APPLYMATE_LEASE_URL', value: 'https://${storage.name}.blob.core.windows.net/runtime/lease' }
        ]
        volumeMounts: [{ volumeName: 'private-data', mountPath: '/home/applymate' }]
        probes: [
          { type: 'Startup', tcpSocket: { port: 8080 }, initialDelaySeconds: 5, periodSeconds: 10, failureThreshold: 30 }
          { type: 'Readiness', tcpSocket: { port: 8080 }, periodSeconds: 10, failureThreshold: 3 }
        ]
      }]
      volumes: [{ name: 'private-data', storageType: 'AzureFile', storageName: 'private-data' }]
      scale: { minReplicas: 1, maxReplicas: 1 }
    }
  }
  dependsOn: [leaseAccess, leases]
}
resource auth 'Microsoft.App/containerApps/authConfigs@2024-03-01' = {
  parent: app
  name: 'current'
  properties: {
    platform: { enabled: true }
    globalValidation: {
      unauthenticatedClientAction: 'RedirectToLoginPage'
      redirectToProvider: 'azureactivedirectory'
    }
    httpSettings: { requireHttps: true }
    identityProviders: {
      azureActiveDirectory: {
        enabled: true
        registration: {
          clientId: microsoftClientId
          clientSecretSettingName: 'microsoft-login'
          openIdIssuer: 'https://login.microsoftonline.com/${tenant().tenantId}/v2.0'
        }
        login: { loginParameters: ['scope=openid profile email', 'prompt=select_account'] }
        validation: {
          allowedAudiences: [microsoftClientId]
          defaultAuthorizationPolicy: { allowedPrincipals: { identities: [ownerObjectId] } }
        }
      }
    }
    login: {
      cookieExpiration: { convention: 'FixedTime', timeToExpiration: '08:00:00' }
      tokenStore: { enabled: false }
    }
  }
}
output url string = origin
