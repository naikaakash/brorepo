@description('Globally unique Azure Static Web App resource name.')
param name string

@description('Azure region for the Static Web App metadata resource.')
param location string = 'centralus'

@description('Tags applied to the prototype resource.')
param tags object = {
  project: 'brocalc'
  environment: 'learning'
}

resource staticWebApp 'Microsoft.Web/staticSites@2023-12-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {
    allowConfigFileUpdates: true
  }
}

output resourceId string = staticWebApp.id
output defaultHostname string = staticWebApp.properties.defaultHostname
