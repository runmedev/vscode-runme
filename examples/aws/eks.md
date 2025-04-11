---
runme:
  id: 01J1AHWVWASPEAP2T32VGA1NMV
  version: v3
---

# AWS EKS Cloud Renderers

Amazon Elastic Kubernetes Service (Amazon EKS) is a managed Kubernetes service to run Kubernetes in the AWS cloud.

Discover how you can leverage Runme's robust Notebook Cloud Renderers to engage with your EKS resources in ways you've never imagined before!

💡 **Important!** Be sure to run through the one-time guide [Getting started with Runme Notebooks for AWS](setup.md).

## AWS Profile

Set up the AWS Profile to ensure proper configuration. If not specified, the default profile will be used.

```sh {"id":"01J1AHWVWASPEAP2T32TP9C71F","promptEnv":"yes","terminalRows":"2"}
export AWS_PROFILE="stateful"
echo "Using AWS Profile $AWS_PROFILE"
```

## List EKS Clusters

One of the fundamental tasks in working with EKS is to list your clusters, serving as the foundation for other operations such as viewing cluster state.

Runme seamlessly integrates with your AWS EKS resource URLs, mirroring your navigation in the AWS Console directly within your Notebook. This eliminates the need to open the console separately; instead, you can access its functionality right within your Notebook file!

Experience it firsthand by running the following URL to see Runme in action:

```sh {"id":"01HZQMSYFXKX89KZZTXEC0FHNQ","terminalRows":"2"}
export EKS_REGION="us-east-1"
echo "EKS_REGION set to $EKS_REGION"
```

```sh {"id":"01HZQMSYFXKX89KZZTXG76VCEN"}
https://$EKS_REGION.console.aws.amazon.com/eks/home?region=$EKS_REGION#/clusters
```

Isn't that cool? that's a **Runme cloud renderer** in Action!

When your AWS Credentials are correctly configured, you'll encounter a table resembling the one found in the AWS Console, showcasing essential details such as:

- Cluster name
- State
- Kubernetes version
- Cluster ARN
- Creation time
- Actions (access cluster details)

You will also find useful links to the AWS Console like:

- EKS Clusters
- Create cluster
- Open EKS Dashboard

## Display specific EKS Cluster

Just as with listing clusters, if you execute an AWS Console link for specific cluster details, you'll dive into a similar experience that offers a comprehensive breakdown of the instance's details.

💡 **Pro tip:** With the EKS clusters list actions column, you can effortlessly visualize cluster details by clicking on the view cluster details icon, eliminating the need to manually paste a specific instance console URL.

For a quick demo of visualizing a specific EKS cluster details, you can replace the cluster placeholder with the instance you want to visualize:

```sh {"id":"01HZQMSYFXKX89KZZTXH6RG4HF","terminalRows":"3"}
export EKS_CLUSTER="dev1"
export EKS_REGION="us-east-1"
echo "EKS_CLUSTER set to $EKS_CLUSTER"
echo "EKS_REGION set to $EKS_REGION"
```

```sh {"background":"false","id":"01HZQMSYFXKX89KZZTXKTTPH3B"}
https://$EKS_REGION.console.aws.amazon.com/eks/home?region=$EKS_REGION#/clusters/$EKS_CLUSTER
```

### Feedback welcome!

Do you have feedback or new ideas ? what about more Runme Cloud renderers for AWS features ?
Feel free to [reach out to us](https://github.com/runmedev/runme?tab=readme-ov-file#feedback)
