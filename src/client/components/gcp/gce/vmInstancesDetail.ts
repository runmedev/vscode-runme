/* eslint-disable max-len */
import { Disposable } from 'vscode'
import { LitElement, html, css } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { protos } from '@google-cloud/compute'

import flexStyles from '../../../styles/flex'

@customElement('vm-instances-detail')
export class VMInstancesDetail extends LitElement implements Disposable {
  protected disposables: Disposable[] = []

  @property({ type: Object })
  instance!: protos.google.cloud.compute.v1.IInstance

  @property({ type: Array })
  disks: protos.google.cloud.compute.v1.IDisk[] = []

  @property({ type: String })
  cellId!: string

  @property({ type: String })
  projectId!: string

  @state()
  activeTabId: string = 'tab-1'

  static styles = [
    flexStyles,
    css`
      table {
        box-sizing: border-box;
        margin: 0px;
        padding: 0px;
        font-weight: 400;
        line-height: 20px;
        text-indent: 0px;
        vertical-align: baseline;
      }

      .tab,
      .panel {
        color: var(--vscode-editor-foreground);
      }

      .active-tab {
        color: var(--vscode-textLink-activeForeground);
        fill: currentcolor;
        border-bottom: solid 2px var(--vscode-activityBarTop-activeBorder);
      }

      .instance-panels {
        background-color: var(--vscode-editorWidget-background);
      }

      .instance-panels .panels {
        background-color: var(--vscode-editorWidget-background);
        border: 1px solid var(--vscode-editorWidget-border);
      }

      .panel-view {
        background-color: var(--vscode-editor-background);
        color: var(--vscode-editor-foreground);
        margin-bottom: 10px;
        padding: 0px;
      }

      .panel-view .action-button {
        padding: 5px;
      }
    `,
  ]

  dispose() {
    this.disposables.forEach(({ dispose }) => dispose())
  }

  private setActiveTab(tab: string) {
    this.activeTabId = tab
  }

  private getTabClass(tab: string) {
    return this.activeTabId === tab ? 'tab active-tab' : 'tab'
  }

  private get zone() {
    return this.instance?.zone?.split?.('/')?.pop?.()
  }

  private get region() {
    if (!this.zone) {
      return ''
    }

    const zoneParts = this.zone.split('-')
    zoneParts.pop()

    return zoneParts.join('-')
  }

  private get consoleUrl() {
    return 'https://console.cloud.google.com'
  }

  private get detailsUlr() {
    return `${this.consoleUrl}/compute/instancesDetail`
  }
  private get instanceConsoleUrl() {
    return `${this.detailsUlr}/zones/${this.zone}/instances/${this?.instance?.name}?project=${this.projectId}`
  }

  private get observabilityConsoleUrl() {
    return `${this.instanceConsoleUrl}&tab=monitoring`
  }

  private get osInfoConsoleUrl() {
    return `${this.instanceConsoleUrl}&tab=os-information`
  }

  private get screenshotConsoleUrl() {
    return `${this.instanceConsoleUrl}&tab=screenshot`
  }

  private get logsConsoleUrl() {
    // eslint-disable-next-line
    const query = `query=resource.type%3D%22gce_instance%22%0Aresource.labels.instance_id%3D%22${this.instance.id}%22;duration=PT1H?project=${this.projectId}`

    return `${this.consoleUrl}/logs/query;${query}`
  }

  private get viewInNetworkTopologyUrl() {
    return `${this.consoleUrl}/net-intelligence/topology?pageState=(%22netTopFilter%22:(%22chips%22:%22%255B%257B_22k_22_3A_22Instance_22_2C_22t_22_3A10_2C_22v_22_3A_22_5C_22${this.instance?.name}_5C_22_22_2C_22i_22_3A_22google.compute.Instance_22%257D%255D%22))&project=${this.projectId}`
  }

  private get bootDisk() {
    return this.disks.filter(() => {
      const attachedDisk = this.instance.disks?.find((ad) => ad.boot)
      return attachedDisk?.boot
    })?.[0]
  }

  private get additionalDisks() {
    return this.disks.filter(() => {
      const attachedDisk = this.instance.disks?.find((ad) => !ad.boot)
      return !attachedDisk?.boot
    })
  }

  private get instanceBasicInformation() {
    return html`<h3>Basic Information</h3>
      <table-view
        .rows="${[
          { key: 'Name', value: this.instance.name },
          { key: 'Instance Id', value: this.instance.id },
          { key: 'Description', value: this.instance.description },
          { key: 'Type', value: this.instance.kind },
          { key: 'Status', value: this.instance.status },
          { key: 'Creation Time', value: this.instance.creationTimestamp },
          { key: 'Zone', value: this.zone },
          { key: 'Instance Template', value: '-' },
          { key: 'In use by', value: '-' },
          { key: 'Reservations', value: this.instance.reservationAffinity?.consumeReservationType },
          { key: 'Labels', value: JSON.stringify(this.instance.labels) },
          { key: 'Tags', value: JSON.stringify(this.instance.tags?.items) },
          { key: 'Deletion protection', value: this.instance.deletionProtection },
          {
            key: 'Confidential VM service',
            value: this.instance.confidentialInstanceConfig?.enableConfidentialCompute,
          },
          { key: 'Preserved state size', value: '-' },
        ]}"
      ></table-view>`
  }

  private get instanceMachineConfiguration() {
    return html`
      <h3>Machine configuration</h3>
      <table-view
        .rows="${[
          { key: 'Machine type', value: this.instance.machineType?.split('/').pop() },
          { key: 'CPU platform', value: this.instance.cpuPlatform },
          { key: 'Minimum CPU Platform', value: this.instance.minCpuPlatform },
          { key: 'Architecture', value: this.instance.disks?.[0]?.architecture || '-' },
          { key: 'vCPUS to core ratio', value: '-' },
          { key: 'Custom visible cores', value: '-' },
          { key: 'Display device', value: this.instance.displayDevice?.enableDisplay },
          { key: 'GPUs', value: '-' },
          { key: 'Resource policies', value: '-' },
        ]}"
      ></table-view>
    `
  }

  private get instanceNetworking() {
    return html`<h3>Networking</h3>
      <table-view
        .rows="${[
          { key: 'Public DNS PTR Record', value: '-' },
          { key: 'Total egress bandwidth tier', value: '-' },
          { key: 'NIC Type', value: '-' },
        ]}"
      ></table-view>`
  }

  private get instanceFirewall() {
    return html`<h4>Firewal</h4>
      <table-view
        .rows="${[
          { key: 'HTTP traffic', value: '-' },
          { key: 'HTTPS traffic', value: '-' },
          { key: 'Allow Load Balancer Health checks', value: '-' },
          { key: 'Network tags', value: '-' },
        ]}"
        .displayable="${(_row: any, _field: string) => {
          return true
        }}"
        .renderer="${(row: any, field: string) => {
          return html`${row[field]}`
        }}"
      /> `
  }

  private get instanceNetworkInterfaces() {
    return html`<h4>Network Interfaces</h4>
      <table-view
      .columns="${[
        'Name',
        'Network',
        'Subnetwork',
        'Primary internal IP address',
        'Alias IP ranges',
        'IP Stack type',
        'External IP address',
        'Network tier',
        'IP Forwarding',
        'Network details',
      ]}"
      .displayable="${(row: any, field: string) => !['nameLink', 'networkLink', 'subnetworkLink'].includes(field)}"
      .rows="${this.instance?.networkInterfaces?.map((nic) => ({
        name: nic.name,
        nameLink: `${this.consoleUrl}/networking/networkinterfaces/zones/${this.zone}/instances/${this.instance?.name}?networkInterface=${nic.name}&project=${this.projectId}&tab=APPLICABLE_FIREWALL_POLICIES&analysisTab=CONNECTIVITY_TEST`,
        network: nic.network?.split('/').pop(),
        networkLink: `${this.consoleUrl}/networking/networks/details/default?project=${this.projectId}&pageTab=OVERVIEW`,
        subnetwork: nic.subnetwork?.split('/').pop(),
        subnetworkLink: `${this.consoleUrl}/networking/subnetworks/details/${this.region}/default?project=${this.projectId}`,
        internalIpAddress: nic.networkIP,
        ipRanges: nic.aliasIpRanges?.map((range) => range.ipCidrRange).join(', '),
        ipStackType: nic.stackType,
        externalIPaddress: nic.accessConfigs?.[0]?.natIP || '-',
        networkTier: nic.accessConfigs?.[0]?.networkTier || '-',
        ipForwarding: nic.networkAttachment || '-',
        networkDetails: '-',
      }))}"
      .renderer="${(row: any, field: string) => {
        switch (field) {
          case 'name':
            return html`<vscode-link class="link" href="${row.nameLink}">
              ${row.name}
            </vscode-link>`
          case 'network':
            return html`<vscode-link class="link" href="${row.networkLink}">
              ${row.network}
            </vscode-link>`
          case 'subnetwork':
            return html`<vscode-link class="link" href="${row.subnetworkLink}">
              ${row.subnetwork}
            </vscode-link>`
          case 'networkDetails':
            return html`<vscode-link class="link" href="${row.nameLink}">
              View Details
            </vscode-link>`

          default:
            return html`${row[field]}`
        }
      }}"
      /></table-view>`
  }

  private get instanceStorage() {
    return html` <h3>Storage</h3>
      <h4>Boot disk</h4>
      <table-view
        .columns="${[
          'Name',
          'Image',
          'Interface type',
          'Size (GB)',
          'Device name',
          'Type',
          'Architecture',
          'Encryption',
          'Mode',
          'When deleting instance',
        ]}"
        .displayable="${(row: any, field: string) => !['nameLink', 'imageLink'].includes(field)}"
        .rows="${((disk) => {
          const urlPattern =
            /https:\/\/www\.googleapis\.com\/compute\/v1\/projects\/([^\/]+)\/global\/images\/([^\/]+)/

          const match = disk?.sourceImage?.match(urlPattern)

          let project,
            image,
            imageLink = ''

          if (match) {
            project = match[1]
            image = match[2]
            imageLink = `${this.consoleUrl}/compute/imagesDetail/projects/${project}/global/images/${image}?project=${this.projectId}`
          }

          const instanceDisk = this.instance.disks?.find((d) => d.deviceName === disk.name)

          return [
            {
              name: disk.name,
              nameLink: `${this.consoleUrl}/compute/disksDetail/zones/${this.zone}/disks/${disk.name}?project=${this.projectId}`,
              image: image,
              imageLink: imageLink,
              interfaceType: instanceDisk?.interface || '-',
              size: disk.sizeGb,
              deviceName: disk.name,
              type: disk?.type?.split?.('/')?.pop?.(),
              architecture: disk.architecture,
              encryption: '-',
              mode: instanceDisk?.mode,
              whenDeletingInstance: instanceDisk?.autoDelete ? 'On instance deletion' : 'Never',
            },
          ]
        })(this.bootDisk)}"
        .renderer="${(row: any, field: string) => {
          switch (field) {
            case 'name':
              return html`<vscode-link class="link" href="${row.nameLink}">
                ${row.name}
              </vscode-link>`
            case 'image':
              if (row.imageLink) {
                return html`<vscode-link class="link" href="${row.imageLink}">
                  ${row.image}
                </vscode-link>`
              }
            default:
              return html`${row[field]}`
          }
        }}"
      ></table-view>`
    // todo(sebastian): this is busted
    // <h4>Additional disks</h4>
    // <table-view
    // .columns="${[
    //   'Name',
    //   'Image',
    //   'Interface type',
    //   'Size (GB)',
    //   'Device name',
    //   'Type',
    //   'Architecture',
    //   'Encryption',
    //   'Mode',
    //   'When deleting instance',
    // ]}"
    // .displayable="${(row: any, field: string) => !['nameLink', 'imageLink'].includes(field)}"
    // .rows="${this.additionalDisks.map((disk) => {
    //   const urlPattern =
    //     /https:\/\/www\.googleapis\.com\/compute\/v1\/projects\/([^\/]+)\/(?:global\/images|zones\/[^\/]+\/disks)\/([^\/]+)/

    //   const match = disk?.selfLink?.match(urlPattern)

    //   let project,
    //     image,
    //     imageLink = ''

    //   if (match) {
    //     project = match[1]
    //     image = match[2]
    //     imageLink = `${this.consoleUrl}/compute/imagesDetail/projects/${project}/global/images/${image}?project=${this.projectId}`
    //   }

    //   const instanceDisk = this.instance.disks?.find((d) => d.deviceName === disk.name)

    //   return [
    //     {
    //       name: disk.name,
    //       nameLink: `${this.consoleUrl}/compute/disksDetail/zones/${this.zone}/disks/${disk.name}?project=${this.projectId}`,
    //       image: image,
    //       imageLink: imageLink,
    //       interfaceType: instanceDisk?.interface || '-',
    //       size: disk.sizeGb,
    //       deviceName: disk.name,
    //       type: disk?.type?.split?.('/')?.pop?.(),
    //       architecture: disk.architecture,
    //       encryption: '-',
    //       mode: instanceDisk?.mode,
    //       whenDeletingInstance: instanceDisk?.autoDelete ? 'On instance deletion' : 'Never',
    //     },
    //   ]
    // })}"
    //   .renderer="${(rows: any[]) => {
    //     return rows.map((row: any) => {
    //       return Object.keys(row).map((field: string) => {
    //         switch (field) {
    //           case 'name':
    //             return html`<vscode-link class="link" href="${row.nameLink}">
    //               ${row.name}
    //             </vscode-link>`
    //           case 'image':
    //             if (row.imageLink) {
    //               return html`<vscode-link class="link" href="${row.imageLink}">
    //                 ${row.image}
    //               </vscode-link>`
    //             }
    //           default:
    //             return html`${row[field]}`
    //         }
    //       })
    //     })
    //   }}"
    // /></table-view>
  }

  private get securityAndAccess() {
    return html`<h3>Security and access</h3>
      <h4>Shielded VM</h4>
      <table-view
        .rows="${[
          { key: 'Secure Boot', value: this.instance.shieldedInstanceConfig?.enableSecureBoot },
          { key: 'vTPM', value: this.instance.shieldedInstanceConfig?.enableVtpm },
          {
            key: 'Integrity Monitoring',
            value: this.instance.shieldedInstanceConfig?.enableIntegrityMonitoring,
          },
        ]}"
      ></table-view>
      <h4>SSH Keys</h4>
      <table-view
        .rows="${[
          { key: 'SSH keys', value: '-' },
          { key: 'Block project-wide SSH keys', value: '-' },
        ]}"
      ></table-view>
      <h4>API and identity management</h4>
      <table-view
        .rows="${[
          {
            key: 'Service account',
            value: this.instance.serviceAccounts?.map((sa) => sa.email).join(','),
          },
        ]}"
      ></table-view>`
  }

  private get instanceManagement() {
    return html`<h3>Management</h3>
    <h4>Data Encryption</h4>
    <table-view
      .rows="${[
        { key: 'Key ID', value: '-' },
        { key: 'Key name', value: '-' },
      ]}"
    /></table-view>
    <h4>Availability policies</h4>
    <table-view
      .rows="${[
        { key: 'VM provisioning model', value: this.instance.scheduling?.provisioningModel },
        { key: 'Max duration', value: '-' },
        { key: 'Preemptibility', value: this.instance.scheduling?.preemptible },
        { key: 'On VM termination', value: '-' },
        { key: 'Host error timeout ', value: '-' },
        { key: 'On host maintenance', value: this.instance.scheduling?.onHostMaintenance },
        { key: 'Automatic restart', value: this.instance.scheduling?.automaticRestart },
        {
          key: 'Customer Managed Encryption Key (CMEK) revocation policy',
          value: '-',
        },
      ]}"
    /></table-view>
    <h4>Sole-tenancy</h4>
    <table-view
      .rows="${[{ key: 'CPU Overcommit', value: '-' }]}"
    /></table-view>`
  }

  render() {
    return html`<div>
      <vscode-panels class="panels" activeid="${this.activeTabId}">
        <vscode-panel-tab
          id="tab-1"
          class="${this.getTabClass('tab-1')}"
          @click="${() => this.setActiveTab('tab-1')}"
        >
          Details
        </vscode-panel-tab>
        <vscode-panel-tab
          id="tab-2"
          class="${this.getTabClass('tab-2')}"
          @click="${() => this.setActiveTab('tab-2')}"
        >
          Observability
        </vscode-panel-tab>
        <vscode-panel-tab
          id="tab-3"
          class="${this.getTabClass('tab-3')}"
          @click="${() => this.setActiveTab('tab-3')}"
        >
          OS Info
        </vscode-panel-tab>
        <vscode-panel-tab
          id="tab-4"
          class="${this.getTabClass('tab-4')}"
          @click="${() => this.setActiveTab('tab-4')}"
        >
          Screenshot
        </vscode-panel-tab>
        <vscode-panel-view id="view-1" class="panel">
          <div class="flex-column w-full">
            <section class="flex-column">
              <vscode-link class="link" href="${this.logsConsoleUrl}">Logs</vscode-link>
            </section>
            <section class="flex-column w-full">${this.instanceBasicInformation}</section>
            <section class="flex-column w-full">${this.instanceMachineConfiguration}</section>
            <section class="flex-column">
              ${this.instanceNetworking}
              <vscode-link class="link" href="${this.viewInNetworkTopologyUrl}">
                View in network topology
              </vscode-link>
            </section>
            <section class="flex-column">${this.instanceFirewall}</section>
            <section class="flex-column">${this.instanceNetworkInterfaces}</section>
            <section class="flex-column">${this.instanceStorage}</section>
            <section class="flex-column">${this.securityAndAccess}</section>
            <section class="flex-column">${this.instanceManagement}</section>
          </div>
        </vscode-panel-view>
        <vscode-panel-view id="view-2" class="panel">
          <vscode-link class="link" href="${this.observabilityConsoleUrl}">
            Observability
          </vscode-link>
        </vscode-panel-view>
        <vscode-panel-view id="view-3" class="panel">
          <vscode-link class="link" href="${this.osInfoConsoleUrl}">OS Info</vscode-link>
        </vscode-panel-view>
        <vscode-panel-view id="view-4" class="panel">
          <vscode-link class="link" href="${this.screenshotConsoleUrl}">Screenshot</vscode-link>
        </vscode-panel-view>
      </vscode-panels>
    </div>`
  }
}
